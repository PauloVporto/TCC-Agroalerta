/**
 * Servidor estático simples, só para servir o frontend durante o
 * desenvolvimento/demonstração do TCC (sem precisar instalar nada extra
 * como live-server). Roda em http://localhost:5173
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 5173;
const DIR = __dirname;

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

http
  .createServer((req, res) => {
    let caminho = req.url === "/" ? "/index.html" : req.url;
    caminho = path.join(DIR, decodeURIComponent(caminho.split("?")[0]));

    fs.readFile(caminho, (erro, conteudo) => {
      if (erro) {
        res.writeHead(404);
        res.end("Não encontrado");
        return;
      }
      const ext = path.extname(caminho);
      res.writeHead(200, { "Content-Type": TIPOS[ext] || "application/octet-stream" });
      res.end(conteudo);
    });
  })
  .listen(PORT, () => {
    console.log("AgroAlerta - frontend rodando em http://localhost:" + PORT);
  });
