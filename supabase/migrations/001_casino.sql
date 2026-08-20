begin;

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    display_name text not null
        check (char_length(display_name) between 2 and 80),
    created_at timestamptz not null default now()
);

create table public.wallets (
    user_id uuid primary key references auth.users(id) on delete cascade,
    balance_cents bigint not null default 100000
        check (
            balance_cents >= 0
            and balance_cents <= 9000000000000000
        ),
    version bigint not null default 0
        check (version between 0 and 9007199254740991),
    updated_at timestamptz not null default now()
);

create table public.wallet_entries (
    id bigint generated always as identity primary key,
    request_id uuid not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    game text not null check (game in ('slot', 'mines')),
    kind text not null check (char_length(kind) between 1 and 64),
    debit_cents bigint not null check (debit_cents >= 0),
    credit_cents bigint not null check (credit_cents >= 0),
    balance_after_cents bigint not null check (balance_after_cents >= 0),
    wallet_version bigint not null
        check (wallet_version between 0 and 9007199254740991),
    created_at timestamptz not null default now(),
    constraint wallet_entries_idempotency_unique
        unique (user_id, game, kind, request_id)
);

create table public.game_rounds (
    id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    game text not null check (game in ('slot', 'mines')),
    bet_cents bigint not null check (bet_cents > 0),
    status text not null
        check (status in ('active', 'won', 'lost', 'cashed_out', 'cancelled')),
    server_state jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    settled_at timestamptz
);

create table public.request_rate_limits (
    user_id uuid not null references auth.users(id) on delete cascade,
    action text not null check (
        action in (
            'slot-spin',
            'mines-start',
            'mines-reveal',
            'mines-cashout',
            'mines-state'
        )
    ),
    bucket_start timestamptz not null,
    request_count integer not null check (request_count between 1 and 1000),
    updated_at timestamptz not null default now(),
    primary key (user_id, action, bucket_start)
);

create index game_rounds_user_created_idx
    on public.game_rounds (user_id, created_at desc);

create unique index game_rounds_one_active_mines_per_user_idx
    on public.game_rounds (user_id)
    where game = 'mines' and status = 'active';

create index wallet_entries_user_created_idx
    on public.wallet_entries (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_entries enable row level security;
alter table public.game_rounds enable row level security;
alter table public.request_rate_limits enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.wallets from anon, authenticated;
revoke all on table public.wallet_entries from anon, authenticated;
revoke all on table public.game_rounds from anon, authenticated;
revoke all on table public.request_rate_limits from public, anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (display_name) on table public.profiles to authenticated;
grant select on table public.wallets to authenticated;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy wallets_select_own
on public.wallets
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    chosen_name text;
begin
    chosen_name := coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'name'), '')
    );

    if chosen_name is null or char_length(chosen_name) < 2 then
        chosen_name := coalesce(
            nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
            'Jogador'
        );
    end if;

    if char_length(chosen_name) < 2 then
        chosen_name := 'Jogador';
    end if;

    insert into public.profiles (id, display_name)
    values (new.id, left(chosen_name, 80));

    insert into public.wallets (user_id)
    values (new.id);

    return new;
end;
$$;

revoke execute on function public.handle_new_auth_user()
from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Também prepara contas criadas antes desta migration.
insert into public.profiles (id, display_name)
select
    id,
    left(
        case
            when char_length(coalesce(
                nullif(btrim(raw_user_meta_data ->> 'display_name'), ''),
                nullif(btrim(raw_user_meta_data ->> 'name'), ''),
                ''
            )) >= 2 then coalesce(
                nullif(btrim(raw_user_meta_data ->> 'display_name'), ''),
                nullif(btrim(raw_user_meta_data ->> 'name'), '')
            )
            when char_length(btrim(split_part(coalesce(email, ''), '@', 1))) >= 2
                then btrim(split_part(email, '@', 1))
            else 'Jogador'
        end,
        80
    )
from auth.users
on conflict (id) do nothing;

insert into public.wallets (user_id)
select id
from auth.users
on conflict (user_id) do nothing;

-- This function is intentionally unavailable to browser roles. Edge Functions
-- call it indirectly through the game-specific RPCs below.
create or replace function public.apply_wallet_entry(
    p_user_id uuid,
    p_request_id uuid,
    p_game text,
    p_kind text,
    p_debit_cents bigint,
    p_credit_cents bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
    inserted_entry_id bigint;
    existing_entry public.wallet_entries%rowtype;
    new_balance bigint;
    new_wallet_version bigint;
    current_balance bigint;
    current_wallet_version bigint;
begin
    if p_user_id is null or p_request_id is null then
        raise exception using errcode = 'P0001', message = 'invalid_identity';
    end if;

    if p_game is null or p_game not in ('slot', 'mines') then
        raise exception using errcode = 'P0001', message = 'invalid_game';
    end if;

    if p_kind is null or char_length(p_kind) not between 1 and 64 then
        raise exception using errcode = 'P0001', message = 'invalid_entry_kind';
    end if;

    if p_debit_cents is null or p_debit_cents < 0
       or p_credit_cents is null or p_credit_cents < 0
       or (p_debit_cents = 0 and p_credit_cents = 0)
       or p_debit_cents > 9000000000000000
       or p_credit_cents > 9000000000000000 then
        raise exception using errcode = 'P0001', message = 'invalid_wallet_amount';
    end if;

    insert into public.wallet_entries (
        request_id,
        user_id,
        game,
        kind,
        debit_cents,
        credit_cents,
        balance_after_cents,
        wallet_version
    )
    values (
        p_request_id,
        p_user_id,
        p_game,
        p_kind,
        p_debit_cents,
        p_credit_cents,
        0,
        0
    )
    on conflict on constraint wallet_entries_idempotency_unique do nothing
    returning id into inserted_entry_id;

    if inserted_entry_id is null then
        select *
        into existing_entry
        from public.wallet_entries
        where user_id = p_user_id
          and game = p_game
          and kind = p_kind
          and request_id = p_request_id;

        if not found
           or existing_entry.debit_cents is distinct from p_debit_cents
           or existing_entry.credit_cents is distinct from p_credit_cents then
            raise exception using errcode = 'P0001', message = 'idempotency_conflict';
        end if;

        return existing_entry.balance_after_cents;
    end if;

    update public.wallets
    set
        balance_cents = balance_cents - p_debit_cents + p_credit_cents,
        version = version + 1,
        updated_at = now()
    where user_id = p_user_id
      and balance_cents >= p_debit_cents
      and balance_cents - p_debit_cents + p_credit_cents
          <= 9000000000000000
      and version < 9007199254740991
    returning balance_cents, version
    into new_balance, new_wallet_version;

    if new_balance is null then
        select balance_cents, version
        into current_balance, current_wallet_version
        from public.wallets
        where user_id = p_user_id;

        if current_balance is null then
            raise exception using errcode = 'P0001', message = 'wallet_not_found';
        elsif current_balance < p_debit_cents then
            raise exception using errcode = 'P0001', message = 'insufficient_balance';
        elsif current_balance - p_debit_cents + p_credit_cents
              > 9000000000000000 then
            raise exception using errcode = 'P0001', message = 'balance_limit_exceeded';
        elsif current_wallet_version >= 9007199254740991 then
            raise exception using errcode = 'P0001', message = 'wallet_version_limit_exceeded';
        else
            raise exception using errcode = 'P0001', message = 'balance_limit_exceeded';
        end if;
    end if;

    update public.wallet_entries
    set
        balance_after_cents = new_balance,
        wallet_version = new_wallet_version
    where id = inserted_entry_id;

    return new_balance;
end;
$$;

create or replace function public.consume_game_rate_limit(
    p_user_id uuid,
    p_action text,
    p_max_requests integer,
    p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    now_value timestamptz := clock_timestamp();
    bucket_number bigint;
    bucket_start_value timestamptz;
    retry_after_value integer;
    current_count integer;
begin
    if p_user_id is null
       or p_action is null
       or p_action not in (
           'slot-spin',
           'mines-start',
           'mines-reveal',
           'mines-cashout',
           'mines-state'
       )
       or p_max_requests is null
       or p_max_requests not between 1 and 1000
       or p_window_seconds is null
       or p_window_seconds not between 1 and 3600 then
        raise exception using
            errcode = 'P0001',
            message = 'invalid_rate_limit';
    end if;

    bucket_number := floor(
        extract(epoch from now_value) / p_window_seconds
    )::bigint;
    bucket_start_value := to_timestamp(
        (bucket_number * p_window_seconds)::double precision
    );
    retry_after_value := greatest(
        1,
        ceil(extract(epoch from (
            bucket_start_value
            + make_interval(secs => p_window_seconds)
            - now_value
        )))::integer
    );

    insert into public.request_rate_limits as rate_limit (
        user_id,
        action,
        bucket_start,
        request_count,
        updated_at
    )
    values (
        p_user_id,
        p_action,
        bucket_start_value,
        1,
        now_value
    )
    on conflict (user_id, action, bucket_start) do update
    set
        request_count = rate_limit.request_count + 1,
        updated_at = excluded.updated_at
    where rate_limit.request_count < p_max_requests
    returning request_count into current_count;

    if current_count is null then
        return jsonb_build_object(
            'allowed', false,
            'error', 'rate_limit_exceeded',
            'limit', p_max_requests,
            'remaining', 0,
            'retryAfterSeconds', retry_after_value
        );
    end if;

    delete from public.request_rate_limits
    where user_id = p_user_id
      and action = p_action
      and bucket_start < bucket_start_value - make_interval(
          secs => greatest(p_window_seconds * 20, 3600)
      );

    return jsonb_build_object(
        'allowed', true,
        'limit', p_max_requests,
        'remaining', greatest(p_max_requests - current_count, 0),
        'retryAfterSeconds', retry_after_value
    );
end;
$$;

create or replace function public.settle_slot_spin(
    p_user_id uuid,
    p_round_id uuid,
    p_bet_cents bigint,
    p_payout_cents bigint,
    p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    inserted_round_id uuid;
    round_row public.game_rounds%rowtype;
    balance_value bigint;
    wallet_version_value bigint;
    stored_state jsonb;
begin
    if p_user_id is null or p_round_id is null
       or p_bet_cents is null or p_bet_cents <= 0
       or p_payout_cents is null or p_payout_cents < 0
       or p_result is null
       or jsonb_typeof(p_result -> 'grid') is distinct from 'array'
       or jsonb_typeof(p_result -> 'wins') is distinct from 'array' then
        raise exception using errcode = 'P0001', message = 'invalid_slot_result';
    end if;

    insert into public.game_rounds (
        id,
        user_id,
        game,
        bet_cents,
        status,
        server_state
    )
    values (
        p_round_id,
        p_user_id,
        'slot',
        p_bet_cents,
        'active',
        p_result
    )
    on conflict (id) do nothing
    returning id into inserted_round_id;

    if inserted_round_id is null then
        select *
        into round_row
        from public.game_rounds
        where id = p_round_id
        for update;

        if not found
           or round_row.user_id is distinct from p_user_id
           or round_row.game is distinct from 'slot'
           or round_row.bet_cents is distinct from p_bet_cents then
            raise exception using errcode = 'P0001', message = 'round_conflict';
        end if;

        select balance_cents, version
        into balance_value, wallet_version_value
        from public.wallets
        where user_id = p_user_id;

        return round_row.server_state || jsonb_build_object(
            'roundId', round_row.id,
            'betCents', round_row.bet_cents,
            'balanceCents', balance_value,
            'walletVersion', wallet_version_value,
            'status', round_row.status
        );
    end if;

    balance_value := public.apply_wallet_entry(
        p_user_id,
        p_round_id,
        'slot',
        'spin',
        p_bet_cents,
        p_payout_cents
    );

    select version
    into wallet_version_value
    from public.wallets
    where user_id = p_user_id;

    stored_state := p_result || jsonb_build_object(
        'payoutCents', p_payout_cents,
        'balanceAfterCents', balance_value,
        'walletVersionAfter', wallet_version_value
    );

    update public.game_rounds
    set
        status = case when p_payout_cents > 0 then 'won' else 'lost' end,
        server_state = stored_state,
        settled_at = now()
    where id = p_round_id
    returning * into round_row;

    return stored_state || jsonb_build_object(
        'roundId', p_round_id,
        'betCents', p_bet_cents,
        'balanceCents', balance_value,
        'walletVersion', wallet_version_value,
        'status', round_row.status
    );
end;
$$;

create or replace function public.start_mines_round(
    p_user_id uuid,
    p_round_id uuid,
    p_bet_cents bigint,
    p_mine_count integer,
    p_mine_positions integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    inserted_round_id uuid;
    round_row public.game_rounds%rowtype;
    distinct_positions integer;
    minimum_position integer;
    maximum_position integer;
    balance_value bigint;
    wallet_version_value bigint;
    state_value jsonb;
begin
    if p_user_id is null or p_round_id is null
       or p_bet_cents is null or p_bet_cents <= 0
       or p_mine_count is null
       or p_mine_count not in (1, 3, 5, 10, 15)
       or p_mine_positions is null
       or cardinality(p_mine_positions) <> p_mine_count then
        raise exception using errcode = 'P0001', message = 'invalid_mines_start';
    end if;

    select count(distinct position)::integer, min(position), max(position)
    into distinct_positions, minimum_position, maximum_position
    from unnest(p_mine_positions) as mine(position);

    if distinct_positions <> p_mine_count
       or minimum_position < 0
       or maximum_position > 24 then
        raise exception using errcode = 'P0001', message = 'invalid_mine_positions';
    end if;

    state_value := jsonb_build_object(
        'mineCount', p_mine_count,
        'minePositions', to_jsonb(p_mine_positions),
        'revealedCells', '[]'::jsonb,
        'payoutCents', 0
    );

    insert into public.game_rounds (
        id,
        user_id,
        game,
        bet_cents,
        status,
        server_state
    )
    values (
        p_round_id,
        p_user_id,
        'mines',
        p_bet_cents,
        'active',
        state_value
    )
    on conflict do nothing
    returning id into inserted_round_id;

    if inserted_round_id is null then
        select *
        into round_row
        from public.game_rounds
        where id = p_round_id
        for update;

        if not found then
            raise exception using
                errcode = 'P0001',
                message = 'active_round_exists';
        end if;

        if round_row.user_id is distinct from p_user_id
           or round_row.game is distinct from 'mines'
           or round_row.bet_cents is distinct from p_bet_cents
           or (round_row.server_state ->> 'mineCount')::integer
              is distinct from p_mine_count then
            raise exception using errcode = 'P0001', message = 'round_conflict';
        end if;

        select balance_cents, version
        into balance_value, wallet_version_value
        from public.wallets
        where user_id = p_user_id;

        return jsonb_build_object(
            'roundId', round_row.id,
            'betCents', round_row.bet_cents,
            'mineCount', p_mine_count,
            'totalSafe', 25 - p_mine_count,
            'safeRevealed', jsonb_array_length(
                coalesce(round_row.server_state -> 'revealedCells', '[]'::jsonb)
            ),
            'balanceCents', balance_value,
            'walletVersion', wallet_version_value,
            'status', round_row.status
        );
    end if;

    balance_value := public.apply_wallet_entry(
        p_user_id,
        p_round_id,
        'mines',
        'start',
        p_bet_cents,
        0
    );

    select version
    into wallet_version_value
    from public.wallets
    where user_id = p_user_id;

    state_value := state_value || jsonb_build_object(
        'balanceAfterStartCents', balance_value,
        'walletVersionAfterStart', wallet_version_value
    );

    update public.game_rounds
    set server_state = state_value
    where id = p_round_id;

    return jsonb_build_object(
        'roundId', p_round_id,
        'betCents', p_bet_cents,
        'mineCount', p_mine_count,
        'totalSafe', 25 - p_mine_count,
        'safeRevealed', 0,
        'balanceCents', balance_value,
        'walletVersion', wallet_version_value,
        'status', 'active'
    );
end;
$$;

create or replace function public.calculate_mines_multiplier(
    p_safe_revealed integer,
    p_mine_count integer
)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
    multiplier_value numeric := 1;
    step_index integer;
begin
    if p_mine_count < 1 or p_mine_count >= 25
       or p_safe_revealed < 0
       or p_safe_revealed > 25 - p_mine_count then
        raise exception using errcode = 'P0001', message = 'invalid_mines_progress';
    end if;

    if p_safe_revealed = 0 then
        return 1.00;
    end if;

    for step_index in 0..p_safe_revealed - 1 loop
        multiplier_value := multiplier_value
            * (25 - step_index)::numeric
            / (25 - p_mine_count - step_index)::numeric;
    end loop;

    return round(multiplier_value * 0.97, 2);
end;
$$;

create or replace function public.calculate_mines_payout_cents(
    p_bet_cents bigint,
    p_safe_revealed integer,
    p_mine_count integer
)
returns bigint
language sql
immutable
strict
set search_path = ''
as $$
    select round(
        p_bet_cents::numeric
        * public.calculate_mines_multiplier(p_safe_revealed, p_mine_count)
    )::bigint;
$$;

create or replace function public.reveal_mines_cell(
    p_user_id uuid,
    p_round_id uuid,
    p_cell_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    round_row public.game_rounds%rowtype;
    state_value jsonb;
    mine_positions integer[];
    revealed_cells integer[];
    mine_count_value integer;
    safe_revealed_value integer;
    total_safe_value integer;
    multiplier_value numeric;
    potential_payout_value bigint;
    payout_value bigint := 0;
    balance_value bigint;
    wallet_version_value bigint;
    hit_mine boolean;
begin
    if p_user_id is null or p_round_id is null
       or p_cell_index is null or p_cell_index < 0 or p_cell_index > 24 then
        raise exception using errcode = 'P0001', message = 'invalid_reveal';
    end if;

    select *
    into round_row
    from public.game_rounds
    where id = p_round_id
      and user_id = p_user_id
      and game = 'mines'
    for update;

    if not found then
        raise exception using errcode = 'P0001', message = 'round_not_found';
    end if;

    state_value := round_row.server_state;
    mine_count_value := (state_value ->> 'mineCount')::integer;
    total_safe_value := 25 - mine_count_value;

    select coalesce(
        array_agg(value::integer order by value::integer),
        array[]::integer[]
    )
    into mine_positions
    from jsonb_array_elements_text(
        coalesce(state_value -> 'minePositions', '[]'::jsonb)
    ) as mine(value);

    select coalesce(
        array_agg(value::integer order by value::integer),
        array[]::integer[]
    )
    into revealed_cells
    from jsonb_array_elements_text(
        coalesce(state_value -> 'revealedCells', '[]'::jsonb)
    ) as revealed(value);

    select count(*)::integer
    into safe_revealed_value
    from unnest(revealed_cells) as cell(value)
    where not (value = any(mine_positions));

    hit_mine := p_cell_index = any(mine_positions);
    multiplier_value := public.calculate_mines_multiplier(
        safe_revealed_value,
        mine_count_value
    );
    potential_payout_value := case
        when safe_revealed_value > 0 then public.calculate_mines_payout_cents(
            round_row.bet_cents,
            safe_revealed_value,
            mine_count_value
        )
        else 0
    end;

    if round_row.status <> 'active' then
        select balance_cents, version
        into balance_value, wallet_version_value
        from public.wallets
        where user_id = p_user_id;

        return jsonb_build_object(
            'roundId', p_round_id,
            'cellIndex', p_cell_index,
            'hitMine', hit_mine,
            'status', round_row.status,
            'safeRevealed', safe_revealed_value,
            'totalSafe', total_safe_value,
            'multiplier', multiplier_value,
            'potentialPayoutCents', potential_payout_value,
            'payoutCents', coalesce((state_value ->> 'payoutCents')::bigint, 0),
            'balanceCents', balance_value,
            'walletVersion', wallet_version_value,
            'minePositions', to_jsonb(mine_positions)
        );
    end if;

    if p_cell_index = any(revealed_cells) then
        select balance_cents, version
        into balance_value, wallet_version_value
        from public.wallets
        where user_id = p_user_id;

        return jsonb_build_object(
            'roundId', p_round_id,
            'cellIndex', p_cell_index,
            'hitMine', false,
            'status', 'active',
            'safeRevealed', safe_revealed_value,
            'totalSafe', total_safe_value,
            'multiplier', multiplier_value,
            'potentialPayoutCents', potential_payout_value,
            'payoutCents', 0,
            'balanceCents', balance_value,
            'walletVersion', wallet_version_value
        );
    end if;

    revealed_cells := array_append(revealed_cells, p_cell_index);
    state_value := jsonb_set(
        state_value,
        '{revealedCells}',
        to_jsonb(revealed_cells),
        true
    );

    if hit_mine then
        update public.game_rounds
        set
            status = 'lost',
            server_state = state_value,
            settled_at = now()
        where id = p_round_id;

        select balance_cents, version
        into balance_value, wallet_version_value
        from public.wallets
        where user_id = p_user_id;

        return jsonb_build_object(
            'roundId', p_round_id,
            'cellIndex', p_cell_index,
            'hitMine', true,
            'status', 'lost',
            'safeRevealed', safe_revealed_value,
            'totalSafe', total_safe_value,
            'multiplier', multiplier_value,
            'potentialPayoutCents', 0,
            'payoutCents', 0,
            'balanceCents', balance_value,
            'walletVersion', wallet_version_value,
            'minePositions', to_jsonb(mine_positions)
        );
    end if;

    safe_revealed_value := safe_revealed_value + 1;
    multiplier_value := public.calculate_mines_multiplier(
        safe_revealed_value,
        mine_count_value
    );
    potential_payout_value := public.calculate_mines_payout_cents(
        round_row.bet_cents,
        safe_revealed_value,
        mine_count_value
    );

    if safe_revealed_value = total_safe_value then
        payout_value := potential_payout_value;
        balance_value := public.apply_wallet_entry(
            p_user_id,
            p_round_id,
            'mines',
            'cashout',
            0,
            payout_value
        );

        select version
        into wallet_version_value
        from public.wallets
        where user_id = p_user_id;

        state_value := state_value || jsonb_build_object(
            'payoutCents', payout_value,
            'multiplier', multiplier_value,
            'balanceAfterCents', balance_value,
            'walletVersionAfter', wallet_version_value
        );

        update public.game_rounds
        set
            status = 'cashed_out',
            server_state = state_value,
            settled_at = now()
        where id = p_round_id;

        return jsonb_build_object(
            'roundId', p_round_id,
            'cellIndex', p_cell_index,
            'hitMine', false,
            'status', 'cashed_out',
            'autoCashedOut', true,
            'safeRevealed', safe_revealed_value,
            'totalSafe', total_safe_value,
            'multiplier', multiplier_value,
            'potentialPayoutCents', payout_value,
            'payoutCents', payout_value,
            'balanceCents', balance_value,
            'walletVersion', wallet_version_value,
            'minePositions', to_jsonb(mine_positions)
        );
    end if;

    update public.game_rounds
    set server_state = state_value
    where id = p_round_id;

    select balance_cents, version
    into balance_value, wallet_version_value
    from public.wallets
    where user_id = p_user_id;

    return jsonb_build_object(
        'roundId', p_round_id,
        'cellIndex', p_cell_index,
        'hitMine', false,
        'status', 'active',
        'autoCashedOut', false,
        'safeRevealed', safe_revealed_value,
        'totalSafe', total_safe_value,
        'multiplier', multiplier_value,
        'potentialPayoutCents', potential_payout_value,
        'payoutCents', 0,
        'balanceCents', balance_value,
        'walletVersion', wallet_version_value
    );
end;
$$;

create or replace function public.cashout_mines_round(
    p_user_id uuid,
    p_round_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    round_row public.game_rounds%rowtype;
    state_value jsonb;
    mine_positions integer[];
    revealed_cells integer[];
    mine_count_value integer;
    safe_revealed_value integer;
    total_safe_value integer;
    multiplier_value numeric;
    payout_value bigint;
    balance_value bigint;
    wallet_version_value bigint;
begin
    if p_user_id is null or p_round_id is null then
        raise exception using errcode = 'P0001', message = 'invalid_cashout';
    end if;

    select *
    into round_row
    from public.game_rounds
    where id = p_round_id
      and user_id = p_user_id
      and game = 'mines'
    for update;

    if not found then
        raise exception using errcode = 'P0001', message = 'round_not_found';
    end if;

    state_value := round_row.server_state;
    mine_count_value := (state_value ->> 'mineCount')::integer;
    total_safe_value := 25 - mine_count_value;

    select coalesce(
        array_agg(value::integer order by value::integer),
        array[]::integer[]
    )
    into mine_positions
    from jsonb_array_elements_text(
        coalesce(state_value -> 'minePositions', '[]'::jsonb)
    ) as mine(value);

    select coalesce(
        array_agg(value::integer order by value::integer),
        array[]::integer[]
    )
    into revealed_cells
    from jsonb_array_elements_text(
        coalesce(state_value -> 'revealedCells', '[]'::jsonb)
    ) as revealed(value);

    select count(*)::integer
    into safe_revealed_value
    from unnest(revealed_cells) as cell(value)
    where not (value = any(mine_positions));

    if round_row.status = 'cashed_out' then
        select balance_cents, version
        into balance_value, wallet_version_value
        from public.wallets
        where user_id = p_user_id;

        return jsonb_build_object(
            'roundId', p_round_id,
            'status', 'cashed_out',
            'safeRevealed', safe_revealed_value,
            'totalSafe', total_safe_value,
            'multiplier', coalesce((state_value ->> 'multiplier')::numeric, 1),
            'payoutCents', coalesce((state_value ->> 'payoutCents')::bigint, 0),
            'balanceCents', balance_value,
            'walletVersion', wallet_version_value,
            'minePositions', to_jsonb(mine_positions)
        );
    end if;

    if round_row.status <> 'active' then
        raise exception using errcode = 'P0001', message = 'round_not_active';
    end if;

    if safe_revealed_value < 1 then
        raise exception using errcode = 'P0001', message = 'nothing_to_cashout';
    end if;

    multiplier_value := public.calculate_mines_multiplier(
        safe_revealed_value,
        mine_count_value
    );
    payout_value := public.calculate_mines_payout_cents(
        round_row.bet_cents,
        safe_revealed_value,
        mine_count_value
    );

    balance_value := public.apply_wallet_entry(
        p_user_id,
        p_round_id,
        'mines',
        'cashout',
        0,
        payout_value
    );

    select version
    into wallet_version_value
    from public.wallets
    where user_id = p_user_id;

    state_value := state_value || jsonb_build_object(
        'payoutCents', payout_value,
        'multiplier', multiplier_value,
        'balanceAfterCents', balance_value,
        'walletVersionAfter', wallet_version_value
    );

    update public.game_rounds
    set
        status = 'cashed_out',
        server_state = state_value,
        settled_at = now()
    where id = p_round_id;

    return jsonb_build_object(
        'roundId', p_round_id,
        'status', 'cashed_out',
        'safeRevealed', safe_revealed_value,
        'totalSafe', total_safe_value,
        'multiplier', multiplier_value,
        'payoutCents', payout_value,
        'balanceCents', balance_value,
        'walletVersion', wallet_version_value,
        'minePositions', to_jsonb(mine_positions)
    );
end;
$$;

create or replace function public.get_mines_state(
    p_user_id uuid,
    p_round_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    round_row public.game_rounds%rowtype;
    state_value jsonb;
    mine_positions integer[];
    revealed_cells integer[];
    revealed_safe_indexes integer[];
    mine_count_value integer;
    safe_revealed_value integer;
    total_safe_value integer;
    multiplier_value numeric;
    potential_payout_value bigint;
    balance_value bigint;
    wallet_version_value bigint;
    response_value jsonb;
begin
    if p_user_id is null then
        raise exception using errcode = 'P0001', message = 'invalid_user';
    end if;

    if p_round_id is null then
        select *
        into round_row
        from public.game_rounds
        where user_id = p_user_id
          and game = 'mines'
          and status = 'active'
        order by created_at desc
        limit 1
        for share;
    else
        select *
        into round_row
        from public.game_rounds
        where id = p_round_id
          and user_id = p_user_id
          and game = 'mines'
        for share;

        if not found then
            raise exception using errcode = 'P0001', message = 'round_not_found';
        end if;
    end if;

    select balance_cents, version
    into balance_value, wallet_version_value
    from public.wallets
    where user_id = p_user_id;

    if not found then
        raise exception using errcode = 'P0001', message = 'wallet_not_found';
    end if;

    if round_row.id is null then
        return jsonb_build_object(
            'roundId', null,
            'status', 'none',
            'balanceCents', balance_value,
            'walletVersion', wallet_version_value
        );
    end if;

    state_value := round_row.server_state;
    mine_count_value := (state_value ->> 'mineCount')::integer;
    total_safe_value := 25 - mine_count_value;

    select coalesce(
        array_agg(value::integer order by value::integer),
        array[]::integer[]
    )
    into mine_positions
    from jsonb_array_elements_text(
        coalesce(state_value -> 'minePositions', '[]'::jsonb)
    ) as mine(value);

    select coalesce(
        array_agg(value::integer order by value::integer),
        array[]::integer[]
    )
    into revealed_cells
    from jsonb_array_elements_text(
        coalesce(state_value -> 'revealedCells', '[]'::jsonb)
    ) as revealed(value);

    select coalesce(
        array_agg(safe_cell.value order by safe_cell.value),
        array[]::integer[]
    )
    into revealed_safe_indexes
    from (
        select distinct cell.value
        from unnest(revealed_cells) as cell(value)
        where not (cell.value = any(mine_positions))
    ) as safe_cell;

    safe_revealed_value := cardinality(revealed_safe_indexes);
    multiplier_value := public.calculate_mines_multiplier(
        safe_revealed_value,
        mine_count_value
    );

    potential_payout_value := case
        when round_row.status = 'active' and safe_revealed_value > 0 then
            public.calculate_mines_payout_cents(
                round_row.bet_cents,
                safe_revealed_value,
                mine_count_value
            )
        when round_row.status in ('cashed_out', 'won') then
            coalesce(
                (state_value ->> 'payoutCents')::bigint,
                public.calculate_mines_payout_cents(
                    round_row.bet_cents,
                    safe_revealed_value,
                    mine_count_value
                )
            )
        else 0
    end;

    response_value := jsonb_build_object(
        'roundId', round_row.id,
        'status', round_row.status,
        'betCents', round_row.bet_cents,
        'mineCount', mine_count_value,
        'totalSafe', total_safe_value,
        'safeRevealed', safe_revealed_value,
        'revealedSafeIndexes', to_jsonb(revealed_safe_indexes),
        'multiplier', multiplier_value,
        'potentialPayoutCents', potential_payout_value,
        'balanceCents', balance_value,
        'walletVersion', wallet_version_value
    );

    if round_row.status <> 'active' then
        response_value := response_value || jsonb_build_object(
            'minePositions', to_jsonb(mine_positions)
        );
    end if;

    return response_value;
end;
$$;

revoke execute on function public.apply_wallet_entry(
    uuid, uuid, text, text, bigint, bigint
) from public, anon, authenticated;
revoke execute on function public.consume_game_rate_limit(
    uuid, text, integer, integer
) from public, anon, authenticated;
revoke execute on function public.settle_slot_spin(
    uuid, uuid, bigint, bigint, jsonb
) from public, anon, authenticated;
revoke execute on function public.start_mines_round(
    uuid, uuid, bigint, integer, integer[]
) from public, anon, authenticated;
revoke execute on function public.calculate_mines_multiplier(
    integer, integer
) from public, anon, authenticated;
revoke execute on function public.calculate_mines_payout_cents(
    bigint, integer, integer
) from public, anon, authenticated;
revoke execute on function public.reveal_mines_cell(
    uuid, uuid, integer
) from public, anon, authenticated;
revoke execute on function public.cashout_mines_round(
    uuid, uuid
) from public, anon, authenticated;
revoke execute on function public.get_mines_state(
    uuid, uuid
) from public, anon, authenticated;

grant execute on function public.settle_slot_spin(
    uuid, uuid, bigint, bigint, jsonb
) to service_role;
grant execute on function public.consume_game_rate_limit(
    uuid, text, integer, integer
) to service_role;
grant execute on function public.start_mines_round(
    uuid, uuid, bigint, integer, integer[]
) to service_role;
grant execute on function public.reveal_mines_cell(
    uuid, uuid, integer
) to service_role;
grant execute on function public.cashout_mines_round(
    uuid, uuid
) to service_role;
grant execute on function public.get_mines_state(
    uuid, uuid
) to service_role;

commit;
