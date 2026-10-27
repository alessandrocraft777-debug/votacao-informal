const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3002);
const SECRET = process.env.SECRET_KEY;

if (!process.env.DATABASE_URL) {
  console.error('Falta configurar DATABASE_URL.');
  process.exit(1);
}

if (!SECRET || SECRET.length < 32) {
  console.error('Falta configurar SECRET_KEY com um segredo forte.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5
});

app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));

function hashToken(token) {
  return crypto.createHmac('sha256', SECRET).update(token).digest('hex');
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/resultados', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'resultados.html'));
});

app.get('/api/resultados', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT candidato, COUNT(*)::int AS votos FROM votos GROUP BY candidato'
    );

    const totals = { Lula: 0, 'Flávio Bolsonaro': 0 };

    for (const row of result.rows) {
      totals[row.candidato] = row.votos;
    }

    res.set('Cache-Control', 'no-store');
    res.json({
      enquete: 'Informal, não oficial',
      total: totals.Lula + totals['Flávio Bolsonaro'],
      candidatos: totals
    });
  } catch (err) {
    console.error('Falha ao consultar resultados.');
    res.status(503).json({ erro: 'Resultados temporariamente indisponíveis.' });
  }
});

app.post('/api/votar', async (req, res) => {
  const token = req.body && req.body.token;
  const candidato = req.body && req.body.candidato;

  if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/i.test(token)) {
    return res.status(400).json({ erro: 'Identificador inválido.' });
  }

  if (!['Lula', 'Flávio Bolsonaro'].includes(candidato)) {
    return res.status(400).json({ erro: 'Escolha um candidato válido.' });
  }

  const id = hashToken(token);

  try {
    const result = await pool.query(
      `INSERT INTO votos (eleitor_hash, candidato, criado_em)
       VALUES ($1, $2, $3)
       ON CONFLICT (eleitor_hash) DO NOTHING
       RETURNING eleitor_hash`,
      [id, candidato, new Date().toISOString()]
    );

    res.set('Cache-Control', 'no-store');

    if (result.rowCount === 0) {
      return res.status(409).json({
        erro: 'Este navegador já registrou um voto nesta enquete.'
      });
    }

    return res.json({ mensagem: 'Voto registrado com sucesso.' });
  } catch (err) {
    console.error('Falha ao registrar voto.');
    return res.status(503).json({
      erro: 'Não foi possível registrar o voto agora. Tente novamente.'
    });
  }
});

app.get('/api/saude', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.set('Cache-Control', 'no-store');
    res.json({ status: 'online' });
  } catch (err) {
    res.status(503).json({ status: 'indisponível' });
  }
});

async function start() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS votos (
      eleitor_hash TEXT PRIMARY KEY,
      candidato TEXT NOT NULL CHECK (
        candidato IN ('Lula', 'Flávio Bolsonaro')
      ),
      criado_em TIMESTAMPTZ NOT NULL
    )
  `);

  app.listen(PORT, '0.0.0.0', () => {
    console.log('Votação disponível na porta ' + PORT);
  });
}

start().catch(async () => {
  console.error('Falha ao iniciar. Confira a conexão com PostgreSQL e as configurações.');
  await pool.end().catch(() => {});
  process.exit(1);
});
