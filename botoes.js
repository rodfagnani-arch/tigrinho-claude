let abaAtual = "claude";

function trocarAba() {
    const claude = document.getElementById("claude");
    const vasco = document.getElementById("vasco");
    const cassino = document.getElementById("cassino");

    claude.style.display = "none";
    vasco.style.display = "block";
    cassino.style.display = "none";

    abaAtual = "vasco";
}

function trocarAbaCassino() {
    const claude = document.getElementById("claude");
    const vasco = document.getElementById("vasco");
    const cassino = document.getElementById("cassino");

    claude.style.display = "none";
    vasco.style.display = "none";
    cassino.style.display = "block";

    abaAtual = "cassino";
}

function irClaude() {
    const claude = document.getElementById("claude");
    const vasco = document.getElementById("vasco");
    const cassino = document.getElementById("cassino");

    claude.style.display = "block";
    vasco.style.display = "none";
    cassino.style.display = "none";
}

1