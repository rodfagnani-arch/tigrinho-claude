let abaAtual = "claude";

function trocarAba() {
    document.getElementById("claude").style.display = "none";
    document.getElementById("vasco").style.display = "block";
    document.getElementById("cassino").style.display = "none";
}

function trocarAbaCassino() {
    document.getElementById("claude").style.display = "none";
    document.getElementById("vasco").style.display = "none";
    document.getElementById("cassino").style.display = "block";
}

function irClaude() {
    document.getElementById("claude").style.display = "block";
    document.getElementById("vasco").style.display = "none";
    document.getElementById("cassino").style.display = "none";
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