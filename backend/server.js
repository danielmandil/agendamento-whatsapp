const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Importa configuração do Firebase
const { db } = require('./firebase-config');

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANTE: Middlewares DEVEM vir ANTES das rotas
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log de TODAS as requisições
app.use((req, res, next) => {
    console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.url}`);
    if (req.method === 'POST') {
        console.log('📦 Body:', req.body);
    }
    next();
});

// Servir arquivos estáticos
const frontendPath = path.resolve(__dirname, '..', 'frontend');
app.use(express.static(frontendPath));
console.log('📁 Servindo arquivos de:', frontendPath);

// Rota específica para a raiz
app.get('/', (req, res) => {
    res.sendFile(path.join(frontendPath, 'setup.html'));
});

// ROTAS DA API

// Teste simples
app.get('/api/test', (req, res) => {
    res.json({ message: 'API funcionando!' });
});

// 1. Criar novo barbeiro
app.post('/api/barbers', async (req, res) => {
    console.log('\n🚨 POST /api/barbers RECEBIDO!');
    console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
    
    try {
        const { businessName, whatsapp, openTime, closeTime, serviceDuration } = req.body;
        
        if (!businessName || !whatsapp) {
            console.log('❌ Dados obrigatórios faltando');
            return res.status(400).json({
                success: false,
                error: 'Nome e WhatsApp são obrigatórios'
            });
        }
        
        const slug = businessName
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^\w\-]+/g, '')
            .replace(/\-\-+/g, '-');
        
        const barberData = {
            businessName,
            whatsapp,
            openTime: parseInt(openTime) || 9,
            closeTime: parseInt(closeTime) || 18,
            serviceDuration: parseInt(serviceDuration) || 30,
            slug,
            createdAt: new Date().toISOString()
        };
        
        console.log('💾 Salvando no Firebase...');
        console.log('   Slug:', slug);
        console.log('   Dados:', JSON.stringify(barberData, null, 2));
        
        // Salva no Firebase
        await db.collection('barbers').doc(slug).set(barberData);
        
        console.log('✅ SALVO COM SUCESSO!\n');
        
        // Detecta se está em produção
        const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : `http://localhost:${PORT}`;

        res.json({
        success: true,
        data: {
            ...barberData,
            bookingUrl: `${baseUrl}/${slug}`
        }
        });
        
    } catch (error) {
        console.error('\n❌ ERRO AO SALVAR:', error.message);
        console.error('Stack:', error.stack);
        
        res.status(500).json({ 
            success: false,
            error: error.message
        });
    }
});

// 2. Buscar barbeiro
app.get('/api/barbers/:slug', async (req, res) => {
    console.log(`📥 GET /api/barbers/${req.params.slug}`);
    
    try {
        const doc = await db.collection('barbers').doc(req.params.slug).get();
        
        if (!doc.exists) {
            return res.status(404).json({ 
                success: false, 
                error: 'Barbeiro não encontrado' 
            });
        }
        
        res.json({
            success: true,
            data: doc.data()
        });
    } catch (error) {
        console.error('❌ Erro:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Rotas para páginas
app.get('/setup', (req, res) => {
    res.sendFile(path.join(frontendPath, 'setup.html'));
});

app.get('/agendar', (req, res) => {
    res.sendFile(path.join(frontendPath, 'agendar.html'));
});

app.get('/', (req, res) => {
    res.redirect('/setup.html');
});

// Rota para barbeiros (deve vir por último)
app.get('/:slug', (req, res) => {
    if (req.params.slug.includes('.')) {
        return res.status(404).send('Not found');
    }
    res.sendFile(path.join(frontendPath, 'agendar.html'));
});

// 3. Criar agendamento
app.post('/api/bookings', async (req, res) => {
    console.log('\n🗓️ POST /api/bookings RECEBIDO!');
    console.log('📦 Dados:', JSON.stringify(req.body, null, 2));
    
    try {
        const { 
            barberSlug, 
            date, 
            time, 
            customerName, 
            customerPhone 
        } = req.body;
        
        // Validações
        if (!barberSlug || !date || !time || !customerName || !customerPhone) {
            return res.status(400).json({
                success: false,
                error: 'Todos os campos são obrigatórios'
            });
        }
        
        // Cria ID único para o agendamento
        const bookingId = `${barberSlug}_${date}_${time.replace(':', '')}`;
        
        const bookingData = {
            bookingId,
            barberSlug,
            date,
            time,
            customerName,
            customerPhone,
            status: 'confirmed',
            createdAt: new Date().toISOString()
        };
        
        // Salva no Firebase
        await db.collection('bookings').doc(bookingId).set(bookingData);
        
        console.log('✅ Agendamento salvo:', bookingId);
        
        res.json({
            success: true,
            data: bookingData
        });
        
    } catch (error) {
        console.error('❌ Erro ao criar agendamento:', error);
        res.status(500).json({ 
            success: false,
            error: error.message
        });
    }
});

// 4. Buscar agendamentos de um dia
app.get('/api/bookings/:barberSlug/:date', async (req, res) => {
    console.log(`📥 GET /api/bookings/${req.params.barberSlug}/${req.params.date}`);
    
    try {
        const { barberSlug, date } = req.params;
        
        const snapshot = await db.collection('bookings')
            .where('barberSlug', '==', barberSlug)
            .where('date', '==', date)
            .get();
        
        const bookings = [];
        snapshot.forEach(doc => {
            bookings.push(doc.data());
        });
        
        console.log(`📅 ${bookings.length} agendamentos encontrados`);
        
        res.json({
            success: true,
            data: bookings
        });
        
    } catch (error) {
        console.error('❌ Erro:', error);
        res.status(500).json({ 
            success: false,
            error: error.message
        });
    }
});

// 5. Buscar agendamentos de um barbeiro
app.get('/api/barbers/:slug/bookings', async (req, res) => {
    try {
        const { slug } = req.params;
        const { date, status } = req.query;
        
        let query = db.collection('bookings').where('barberSlug', '==', slug);
        
        if (date) {
            query = query.where('date', '==', date);
        }
        
        if (status) {
            query = query.where('status', '==', status);
        }
        
        const snapshot = await query.orderBy('date', 'desc').orderBy('time', 'desc').get();
        
        const bookings = [];
        snapshot.forEach(doc => {
            bookings.push({ id: doc.id, ...doc.data() });
        });
        
        res.json({
            success: true,
            data: bookings
        });
        
    } catch (error) {
        console.error('Erro ao buscar agendamentos:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Inicia servidor
app.listen(PORT, () => {
    console.log('\n========================================');
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log('========================================');
    console.log(`📱 Acesse:`);
    console.log(`   Setup: http://localhost:${PORT}/setup.html`);
    console.log(`   API Test: http://localhost:${PORT}/api/test`);
    console.log('========================================\n');
});