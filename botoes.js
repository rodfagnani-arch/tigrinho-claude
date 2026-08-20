let abaAtual = "claude";

function mostrarAba(idDaAba) {
    ["claude", "vasco", "cassino", "aryel"].forEach(id => {
        const aba = document.getElementById(id);
        if (aba) aba.style.display = id === idDaAba ? "block" : "none";
    });

    abaAtual = idDaAba;

    if (idDaAba !== "aryel") {
        const audio = document.getElementById("aryelAudio");
        if (audio) audio.pause();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function trocarAba() {
    mostrarAba("vasco");
}

function trocarAbaCassino() {
    mostrarAba("cassino");
}

function irClaude() {
    mostrarAba("claude");
}

function abrirAryel() {
    mostrarAba("aryel");
}

// abrir jogo
function abrirRoleta() {
  document.getElementById("menuCassino").style.display = "none";
  document.getElementById("roletaArea").style.display = "block";
}

// voltar pro menu
function voltarCassino() {
  document.getElementById("menuCassino").style.display = "block";
  document.getElementById("roletaArea").style.display = "none";
}

document.addEventListener("DOMContentLoaded", function() {

    const menu = document.getElementById("menu");

    // abrir/fechar menu
    menu.addEventListener("click", function(e) {
        e.stopPropagation();
        menu.classList.toggle("ativo");
    });

    // clicar fora fecha
    document.addEventListener("click", function() {
        menu.classList.remove("ativo");
    });

    // clicar nas opções fecha sem bugar
    document.querySelectorAll(".conteudo p").forEach(item => {
        item.addEventListener("click", function(e) {
            e.stopPropagation(); // 🔥 ESSENCIAL
            menu.classList.remove("ativo");
        });
    });

});

/* 🔥 CONTROLE */
let mostrandoVasco = true;

/* 🔥 TROCAR IMAGEM */
function trocarImagem() {

    let img = document.getElementById("vasco-img");

    if (mostrandoVasco) {

        img.src = "assets/img/pedro.jpeg";

    } else {

        img.src = "https://www.parrotwebsite.com/wp-content/uploads/2020/09/cockate.jpg";

    }

    mostrandoVasco = !mostrandoVasco;
}

document.addEventListener("DOMContentLoaded", () => {

    const btnMines = document.getElementById("btn-mines");

    const menuCassino = document.getElementById("menuCassino");
    const minesArea = document.getElementById("mines-area");

    const voltarMines = document.getElementById("voltar-mines");

    // abrir mines
    btnMines.addEventListener("click", () => {
        menuCassino.style.display = "none";
        minesArea.style.display = "block";
    });

    // voltar
    voltarMines.addEventListener("click", () => {
        minesArea.style.display = "none";
        menuCassino.style.display = "block";
    });

});

// Área secreta Aryel: use o campo de código ou clique 5 vezes no título principal.
document.addEventListener("DOMContentLoaded", () => {
    const codigoSecreto = [
        "aryel",
        "ariri",
        "macio",
        "passivo",
        "mestre",
        "safado",
        "vivi"
    ];
    const tituloClaude = document.querySelector("#claude h1");
    const formularioSecreto = document.getElementById("secretAccess");
    const campoSecreto = document.getElementById("secretCode");
    const feedbackSecreto = document.getElementById("secretFeedback");
    const audio = document.getElementById("aryelAudio");
    const botaoAudio = document.getElementById("aryelPlay");
    const statusAudio = document.getElementById("aryelAudioStatus");
    let cliquesNoTitulo = [];

    formularioSecreto?.addEventListener("submit", event => {
        event.preventDefault();
        const codigoDigitado = campoSecreto.value.trim().toLowerCase();

        if (codigoSecreto.includes(codigoDigitado)) {
            feedbackSecreto.textContent = "Código aceito.";
            formularioSecreto.classList.remove("has-error");
            campoSecreto.value = "";
            abrirAryel();
        } else {
            feedbackSecreto.textContent = "Código incorreto.";
            formularioSecreto.classList.remove("has-error");
            void formularioSecreto.offsetWidth;
            formularioSecreto.classList.add("has-error");
            campoSecreto.select();
        }
    });

    tituloClaude?.addEventListener("click", () => {
        const agora = Date.now();
        cliquesNoTitulo = cliquesNoTitulo.filter(instante => agora - instante < 3500);
        cliquesNoTitulo.push(agora);

        if (cliquesNoTitulo.length >= 5) {
            abrirAryel();
            cliquesNoTitulo = [];
        }
    });

    document.querySelectorAll(".aryel-image").forEach(imagem => {
        const atualizarImagem = () => {
            imagem.classList.toggle("is-missing", !imagem.complete || imagem.naturalWidth === 0);
        };

        imagem.addEventListener("load", atualizarImagem);
        imagem.addEventListener("error", atualizarImagem);
        atualizarImagem();
    });

    botaoAudio?.addEventListener("click", async () => {
        if (audio.paused) {
            try {
                await audio.play();
                botaoAudio.classList.add("is-playing");
                botaoAudio.setAttribute("aria-pressed", "true");
                botaoAudio.innerHTML = '<span aria-hidden="true">Ⅱ</span> Pausar áudio';
                statusAudio.textContent = "Reproduzindo agora";
            } catch {
                statusAudio.textContent = "Adicione o arquivo audio/aryel.mp3";
            }
        } else {
            audio.pause();
        }
    });

    audio?.addEventListener("pause", () => {
        botaoAudio.classList.remove("is-playing");
        botaoAudio.setAttribute("aria-pressed", "false");
        botaoAudio.innerHTML = '<span aria-hidden="true">▶</span> Reproduzir áudio';
        if (audio.currentTime > 0 && !audio.ended) statusAudio.textContent = "Áudio pausado";
    });

    audio?.addEventListener("ended", () => {
        statusAudio.textContent = "Reprodução concluída";
    });
});
