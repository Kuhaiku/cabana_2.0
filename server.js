require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const crypto = require("crypto"); // Para gerar tokens únicos
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações
app.use(cors());
app.use(express.json()); // Substitui body-parser
app.use(express.static("public"));

// --- CONEXÃO MYSQL ---
const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Ping para manter conexão viva
setInterval(() => {
    db.query("SELECT 1", (err) => {
        if (err) console.error("Ping DB Error:", err);
    });
}, 30000);

// --- MIDDLEWARE DE SEGURANÇA (ADMIN) ---
const checkAuth = (req, res, next) => {
    const password = req.headers["x-admin-password"];
    if (password !== process.env.ADMIN_PASS) {
        return res.status(401).json({ message: "Senha de administrador incorreta." });
    }
    next();
};

// ==========================================
//            ROTAS PÚBLICAS (CLIENTE)
// ==========================================

// 1. Listar Itens Disponíveis (Filtra ocultos)
app.get("/api/itens-disponiveis", (req, res) => {
    const sql = "SELECT descricao, categoria, valor FROM tabela_precos WHERE disponivel = TRUE ORDER BY categoria, descricao";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json([]);
        res.json(results);
    });
});

// 2. Criar Novo Pedido
app.post("/api/orcamento", (req, res) => {
    const data = req.body;
    const sql = `
        INSERT INTO orcamentos (
            nome, whatsapp, endereco, qtd_criancas, faixa_etaria,
            modelo_barraca, qtd_barracas, cores, tema, 
            itens_padrao, itens_adicionais, data_festa, horario, 
            alimentacao, alergias
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
        data.nome, data.whatsapp, data.endereco, data.qtd_criancas, data.faixa_etaria,
        data.modelo_barraca, data.qtd_barracas, data.cores, data.tema,
        JSON.stringify(data.itens_padrao), data.itens_adicionais, data.data_festa, data.horario,
        JSON.stringify(data.alimentacao), data.alergias
    ];

    db.query(sql, values, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ success: true });
    });
});

// 3. Listar Depoimentos (Para o site)
app.get("/api/depoimentos", (req, res) => {
    const sql = "SELECT cliente_nome, rating, comentario, fotos_urls, data_avaliacao FROM avaliacoes WHERE visivel = TRUE ORDER BY data_avaliacao DESC";
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json([]);
        res.json(results);
    });
});

// 4. Salvar Avaliação do Cliente
app.post("/api/cliente/avaliar", (req, res) => {
    const { token, rating, comentario, fotos } = req.body;
    
    // Verifica token e pega ID do orçamento
    db.query("SELECT id, nome FROM orcamentos WHERE token_avaliacao = ?", [token], (err, results) => {
        if (err || results.length === 0) return res.status(400).json({ error: "Token inválido" });
        
        const orcamento = results[0];
        const sqlInsert = "INSERT INTO avaliacoes (id_orcamento, cliente_nome, rating, comentario, fotos_urls) VALUES (?, ?, ?, ?, ?)";
        
        db.query(sqlInsert, [orcamento.id, orcamento.nome, rating, comentario, JSON.stringify(fotos)], (insertErr) => {
            if (insertErr) return res.status(500).json({ error: insertErr });
            
            // Opcional: Invalida o token para não avaliar 2 vezes (ou mantém para edição)
            // db.query("UPDATE orcamentos SET token_avaliacao = NULL WHERE id = ?", [orcamento.id]);
            
            res.json({ success: true });
        });
    });
});

// ==========================================
//            ROTAS ADMIN (PAINEL)
// ==========================================

// --- GESTÃO DE PEDIDOS ---
app.get("/api/admin/pedidos", checkAuth, (req, res) => {
    db.query("SELECT * FROM orcamentos ORDER BY data_pedido DESC", (err, results) => {
        if (err) return res.status(500).json({ error: err });
        res.json(results);
    });
});

app.delete("/api/admin/pedidos/:id", checkAuth, (req, res) => {
    db.query("DELETE FROM orcamentos WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});

// --- FLUXO: APROVAÇÃO E AGENDA ---

// Aprovar: Gera token e move para Agenda
app.put("/api/admin/pedidos/:id/aprovar", checkAuth, (req, res) => {
    const token = crypto.randomBytes(16).toString("hex");
    const sql = "UPDATE orcamentos SET status = 'aprovado', token_avaliacao = ? WHERE id = ?";
    
    db.query(sql, [token, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err });
        // Retorna o link para o admin copiar se quiser enviar manualmente
        res.json({ success: true, link_avaliacao: `${req.protocol}://${req.get('host')}/avaliar.html?t=${token}` });
    });
});

// Listar Agenda (Apenas Aprovados)
app.get("/api/admin/agenda", checkAuth, (req, res) => {
    // Formato compatível com FullCalendar
    const sql = `
        SELECT id, nome as title, data_festa as start, 
        whatsapp, endereco, horario, modelo_barraca, qtd_barracas 
        FROM orcamentos WHERE status = 'aprovado'
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json([]);
        res.json(results);
    });
});

// Concluir Serviço (Libera Avaliação)
app.put("/api/admin/pedidos/:id/concluir", checkAuth, (req, res) => {
    const sql = "UPDATE orcamentos SET status = 'concluido' WHERE id = ?";
    db.query(sql, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});

// --- FINANCEIRO ---

app.get("/api/admin/financeiro", checkAuth, (req, res) => {
    // Une entradas de festas concluídas com lançamentos manuais
    const sql = `
        SELECT id, 'entrada' as tipo, CONCAT('Festa: ', nome) as titulo, valor_final as valor, data_festa as data 
        FROM orcamentos WHERE status = 'concluido'
        UNION ALL
        SELECT id, tipo, titulo, valor, data_lancamento as data FROM financeiro
        ORDER BY data DESC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json([]);
        res.json(results);
    });
});

app.post("/api/admin/financeiro", checkAuth, (req, res) => {
    const { tipo, titulo, valor, descricao } = req.body;
    const sql = "INSERT INTO financeiro (tipo, titulo, valor, descricao) VALUES (?, ?, ?, ?)";
    db.query(sql, [tipo, titulo, valor, descricao], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});

// --- GESTÃO DE PREÇOS E ESTOQUE ---

app.get("/api/admin/precos", checkAuth, (req, res) => {
    db.query("SELECT * FROM tabela_precos ORDER BY categoria, descricao", (err, results) => {
        if (err) return res.status(500).json({ error: err });
        res.json(results);
    });
});

app.post("/api/admin/precos", checkAuth, (req, res) => {
    const { descricao, valor, categoria } = req.body;
    const item_chave = "custom_" + Date.now();
    const sql = "INSERT INTO tabela_precos (item_chave, descricao, valor, categoria, disponivel) VALUES (?, ?, ?, ?, true)";
    db.query(sql, [item_chave, descricao, valor, categoria], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});

app.put("/api/admin/precos/:id/toggle", checkAuth, (req, res) => {
    const { disponivel } = req.body;
    db.query("UPDATE tabela_precos SET disponivel = ? WHERE id = ?", [disponivel, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});

app.delete("/api/admin/precos/:id", checkAuth, (req, res) => {
    db.query("DELETE FROM tabela_precos WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ success: true });
    });
});

// Inicialização
app.listen(PORT, () => {
    console.log(`✅ Servidor Cabana rodando na porta ${PORT}`);
});