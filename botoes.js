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