require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Configuração Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Conexão MySQL
const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Ping DB
setInterval(() => {
    db.query("SELECT 1", (err) => { if (err) console.error("Ping DB Error:", err.code); });
}, 30000);

const checkAuth = (req, res, next) => {
    if (req.headers["x-admin-password"] !== process.env.ADMIN_PASS) {
        return res.status(401).json({ message: "Senha incorreta." });
    }
    next();
};

// --- ROTAS CLOUDINARY ---
app.get("/api/galeria", async (req, res) => {
    try {
        const result = await cloudinary.api.resources({
            type: 'upload',
            prefix: 'cabana/galeria/', // Pasta correta
            max_results: 30
        });
        const urls = result.resources.map(img => img.secure_url);
        res.json(urls);
    } catch (error) {
        console.error("Erro Cloudinary:", error);
        res.json([]);
    }
});

// --- ROTAS PÚBLICAS ---
app.get("/api/itens-disponiveis", (req, res) => {
    db.query("SELECT * FROM tabela_precos WHERE disponivel = TRUE ORDER BY categoria, descricao", (err, results) => {
        if (err) return res.status(500).json([]);
        res.json(results);
    });
});

app.post("/api/orcamento", (req, res) => {
    const data = req.body;
    const sql = `INSERT INTO orcamentos (nome, whatsapp, endereco, qtd_criancas, faixa_etaria, modelo_barraca, qtd_barracas, cores, tema, itens_padrao, itens_adicionais, data_festa, horario, alimentacao, alergias) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [data.nome, data.whatsapp, data.endereco, data.qtd_criancas, data.faixa_etaria, data.modelo_barraca, data.qtd_barracas, data.cores, data.tema, JSON.stringify(data.itens_padrao), data.itens_adicionais, data.data_festa, data.horario, JSON.stringify(data.alimentacao), data.alergias];
    
    db.query(sql, values, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ success: true });
    });
});

app.get("/api/depoimentos", (req, res) => {
    db.query("SELECT * FROM avaliacoes WHERE visivel = TRUE ORDER BY data_avaliacao DESC", (err, results) => {
        if (err) return res.status(500).json([]);
        res.json(results);
    });
});

app.post("/api/cliente/avaliar", (req, res) => {
    const { token, rating, comentario, fotos } = req.body;
    db.query("SELECT id, nome FROM orcamentos WHERE token_avaliacao = ?", [token], (err, results) => {
        if (err || results.length === 0) return res.status(400).json({ error: "Token inválido" });
        const orcamento = results[0];
        db.query("INSERT INTO avaliacoes (id_orcamento, cliente_nome, rating, comentario, fotos_urls) VALUES (?, ?, ?, ?, ?)", 
        [orcamento.id, orcamento.nome, rating, comentario, JSON.stringify(fotos)], (insertErr) => {
            if (insertErr) return res.status(500).json({ error: insertErr });
            res.json({ success: true });
        });
    });
});

// --- ROTAS ADMIN ---
app.get("/api/admin/pedidos", checkAuth, (req, res) => {
    db.query("SELECT * FROM orcamentos ORDER BY data_pedido DESC", (err, results) => res.json(results));
});

app.put("/api/admin/pedidos/:id/aprovar", checkAuth, (req, res) => {
    const token = crypto.randomBytes(8).toString("hex");
    db.query("UPDATE orcamentos SET status = 'aprovado', token_avaliacao = ? WHERE id = ?", [token, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true, link: `/avaliar.html?t=${token}` });
    });
});

app.delete("/api/admin/pedidos/:id", checkAuth, (req, res) => {
    db.query("DELETE FROM orcamentos WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});

app.get("/api/admin/agenda", checkAuth, (req, res) => {
    db.query("SELECT id, nome as title, data_festa as start, whatsapp, endereco, horario, modelo_barraca, qtd_barracas FROM orcamentos WHERE status = 'aprovado'", (err, results) => res.json(results));
});

app.put("/api/admin/pedidos/:id/concluir", checkAuth, (req, res) => {
    db.query("UPDATE orcamentos SET status = 'concluido' WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});

// Financeiro
app.get("/api/admin/financeiro", checkAuth, (req, res) => {
    const sql = `SELECT id, 'entrada' as tipo, CONCAT('Festa: ', nome) as titulo, valor_final as valor, data_festa as data FROM orcamentos WHERE status = 'concluido' UNION ALL SELECT id, tipo, titulo, valor, data_lancamento as data FROM financeiro ORDER BY data DESC`;
    db.query(sql, (err, results) => res.json(results));
});
app.post("/api/admin/financeiro", checkAuth, (req, res) => {
    const { tipo, titulo, valor } = req.body;
    db.query("INSERT INTO financeiro (tipo, titulo, valor) VALUES (?, ?, ?)", [tipo, titulo, valor], (err) => res.json({ success: true }));
});

// Preços
app.get("/api/admin/precos", checkAuth, (req, res) => db.query("SELECT * FROM tabela_precos ORDER BY categoria, descricao", (err, results) => res.json(results)));
app.post("/api/admin/precos", checkAuth, (req, res) => {
    const { descricao, valor, categoria } = req.body;
    db.query("INSERT INTO tabela_precos (item_chave, descricao, valor, categoria) VALUES (?, ?, ?, ?)", ["custom_"+Date.now(), descricao, valor, categoria], (err) => res.json({ success: true }));
});
app.put("/api/admin/precos/:id/toggle", checkAuth, (req, res) => {
    db.query("UPDATE tabela_precos SET disponivel = ? WHERE id = ?", [req.body.disponivel, req.params.id], (err) => res.json({ success: true }));
});
app.delete("/api/admin/precos/:id", checkAuth, (req, res) => {
    db.query("DELETE FROM tabela_precos WHERE id = ?", [req.params.id], (err) => res.json({ success: true }));
});

app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));