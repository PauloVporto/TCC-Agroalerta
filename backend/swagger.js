const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "AgroAlerta API",
      version: "1.0.0",
      description:
        "API do AgroAlerta - TCC de Engenharia de Software. Alertas climáticos por talhão, " +
        "comparação de preços de insumos e análise de tendência de mercado para produtores rurais.",
    },
    servers: [
      { url: "/api", description: "Servidor atual" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description:
            'Token de sessão obtido em /auth/login ou /auth/registrar. Envie como "Authorization: Bearer <token>".',
        },
      },
      schemas: {
        Erro: {
          type: "object",
          properties: {
            erro: { type: "string", example: "Mensagem descrevendo o problema." },
          },
        },
        Usuario: {
          type: "object",
          properties: {
            id: { type: "integer", example: 1 },
            nome: { type: "string", example: "Marina Rezende Alves" },
            email: { type: "string", example: "marina@fazenda.com.br" },
            cidade: { type: "string", nullable: true, example: "Santa Rita do Sapucaí - MG" },
            cidadeFormatada: { type: "string", nullable: true },
            latitude: { type: "number", nullable: true, example: -22.2486968 },
            longitude: { type: "number", nullable: true, example: -45.7064507 },
            criadoEm: { type: "string", format: "date-time" },
          },
        },
        Talhao: {
          type: "object",
          properties: {
            id: { type: "integer", example: 1 },
            usuarioId: { type: "integer", example: 1 },
            nome: { type: "string", example: "Talhão principal - Santa Rita do Sapucaí" },
            cultura: { type: "string", enum: ["cafe", "soja", "milho", "cana", "feijao"] },
            fase: { type: "string", example: "floracao" },
            endereco: { type: "string" },
            enderecoFormatado: { type: "string", nullable: true },
            latitude: { type: "number" },
            longitude: { type: "number" },
            criadoEm: { type: "string", format: "date-time" },
          },
        },
        Alerta: {
          type: "object",
          properties: {
            id: { type: "string", example: "cafe_geada" },
            titulo: { type: "string", example: "Risco de geada" },
            cultura: { type: "string", example: "cafe" },
            fase: { type: "string", example: "floracao" },
            nivel: { type: "string", enum: ["baixo", "medio", "alto"] },
            mensagem: { type: "string" },
            recomendacao: { type: "string" },
            geradoEm: { type: "string", format: "date-time" },
          },
        },
        Clima: {
          type: "object",
          properties: {
            temperaturaMinima: { type: "number", example: 14.78 },
            chuvaAcumulada7dias: { type: "number", example: 22.7 },
            diasSemChuva: { type: "integer", example: 1 },
            probabilidadeChuva7dias: { type: "integer", example: 40 },
            ventoMaximoKmh: { type: "number", example: 15 },
            fonte: { type: "string", example: "openmeteo" },
            previsaoDiaria: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  data: { type: "string", format: "date", example: "2026-09-22" },
                  tempMax: { type: "number", example: 29 },
                  tempMin: { type: "number", example: 17 },
                  chuvaMm: { type: "number", example: 1.7 },
                  chuvaProbabilidade: { type: "integer", example: 28 },
                },
              },
            },
          },
        },
        Insumo: {
          type: "object",
          properties: {
            id: { type: "string" },
            nome: { type: "string", example: "Fungicida sistêmico 1L" },
            categoria: { type: "string", example: "fungicida" },
            unidade: { type: "string", example: "litro" },
            ofertas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  fornecedor: { type: "string" },
                  cidade: { type: "string" },
                  preco: { type: "number" },
                },
              },
            },
            melhorPreco: { type: "object" },
          },
        },
      },
    },
  },
  apis: ["./routes/*.js"],
};

module.exports = swaggerJsdoc(options);
