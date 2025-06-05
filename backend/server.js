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

// 1. Criar novo barbeiro - VERSÃO ATUALIZADA
app.post('/api/barbers', async (req, res) => {
    console.log('\n🚨 POST /api/barbers RECEBIDO!');
    console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
    
    try {
        const {
            businessName,
            whatsapp,
            address = '',
            openTime,
            closeTime,
            bufferTime = 10,
            workingDays = [1,2,3,4,5,6], // Segunda a Sábado por padrão
            services = [],
            minAdvanceTime = 2,
            maxBookingsPerDay = 0,
            hasLunchBreak = false,
            lunchStart = null,
            lunchEnd = null,
            // Campos antigos para compatibilidade
            serviceDuration
        } = req.body;

        // Validações básicas
        if (!businessName || !whatsapp) {
            console.log('❌ Dados obrigatórios faltando');
            return res.status(400).json({
                success: false,
                error: 'Nome da barbearia e WhatsApp são obrigatórios'
            });
        }

        // Se não tiver serviços, criar um padrão (compatibilidade com versão antiga)
        let finalServices = services;
        if (!services || services.length === 0) {
            finalServices = [{
                name: 'Corte de cabelo',
                duration: parseInt(serviceDuration) || 30,
                price: 35.00
            }];
        }

        // Validar se tem pelo menos um serviço
        if (finalServices.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Configure pelo menos um serviço'
            });
        }

        // Validar dias de funcionamento
        if (workingDays.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Configure pelo menos um dia de funcionamento'
            });
        }

        // Gerar slug único (melhorado)
        const slug = businessName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove acentos
            .replace(/[^a-z0-9\s]/g, '') // Remove caracteres especiais
            .replace(/\s+/g, '-') // Substitui espaços por hífens
            .replace(/-+/g, '-') // Remove hífens duplicados
            .replace(/^-|-$/g, '') // Remove hífens do início e fim
            .trim();

        // Dados do barbeiro (estrutura atualizada)
        const barberData = {
            businessName,
            whatsapp,
            address,
            openTime: parseInt(openTime) || 9,
            closeTime: parseInt(closeTime) || 18,
            bufferTime: parseInt(bufferTime),
            workingDays: Array.isArray(workingDays) ? workingDays.map(day => parseInt(day)) : [1,2,3,4,5,6],
            services: finalServices,
            minAdvanceTime: parseInt(minAdvanceTime),
            maxBookingsPerDay: parseInt(maxBookingsPerDay),
            hasLunchBreak: Boolean(hasLunchBreak),
            lunchStart,
            lunchEnd,
            slug,
            createdAt: new Date().toISOString(),
            // Campos antigos para compatibilidade
            serviceDuration: finalServices[0]?.duration || 30
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

// 3. Buscar horários disponíveis - VERSÃO ATUALIZADA
app.get('/api/bookings/:barberSlug/:date', async (req, res) => {
    console.log(`📥 GET /api/bookings/${req.params.barberSlug}/${req.params.date}`);
    
    try {
        const { barberSlug, date } = req.params;
        
        // Buscar dados do barbeiro
        const barberDoc = await db.collection('barbers').doc(barberSlug).get();
        if (!barberDoc.exists) {
            return res.status(404).json({ 
                success: false, 
                error: 'Barbeiro não encontrado' 
            });
        }
        
        const barberData = barberDoc.data();
        
        // Verificar se é um dia de funcionamento
        const dateObj = new Date(date + 'T12:00:00');
        const dayOfWeek = dateObj.getDay();
        
        if (barberData.workingDays && !barberData.workingDays.includes(dayOfWeek)) {
            return res.json({ 
                success: true, 
                data: [],
                barberConfig: {
                    openTime: barberData.openTime,
                    closeTime: barberData.closeTime,
                    bufferTime: barberData.bufferTime || 10,
                    services: barberData.services || [{ duration: barberData.serviceDuration || 30 }],
                    hasLunchBreak: barberData.hasLunchBreak || false,
                    lunchStart: barberData.lunchStart,
                    lunchEnd: barberData.lunchEnd,
                    minAdvanceTime: barberData.minAdvanceTime || 2
                },
                message: 'Não funciona neste dia da semana'
            });
        }
        
        // Buscar agendamentos existentes para a data
        const snapshot = await db.collection('bookings')
            .where('barberSlug', '==', barberSlug)
            .where('date', '==', date)
            .where('status', '==', 'confirmed')
            .get();
        
        const bookings = [];
        snapshot.forEach(doc => {
            bookings.push(doc.data());
        });
        
        console.log(`📅 ${bookings.length} agendamentos encontrados`);
        
        res.json({
            success: true,
            data: bookings,
            barberConfig: {
                openTime: barberData.openTime,
                closeTime: barberData.closeTime,
                bufferTime: barberData.bufferTime || 10,
                services: barberData.services || [{ duration: barberData.serviceDuration || 30 }],
                hasLunchBreak: barberData.hasLunchBreak || false,
                lunchStart: barberData.lunchStart,
                lunchEnd: barberData.lunchEnd,
                minAdvanceTime: barberData.minAdvanceTime || 2
            }
        });
        
    } catch (error) {
        console.error('❌ Erro:', error);
        res.status(500).json({ 
            success: false,
            error: error.message
        });
    }
});

// 4. Criar agendamento - VERSÃO ATUALIZADA
app.post('/api/bookings', async (req, res) => {
    console.log('\n🗓️ POST /api/bookings RECEBIDO!');
    console.log('📦 Dados:', JSON.stringify(req.body, null, 2));
    
    try {
        const {
            barberSlug,
            date,
            time,
            customerName,
            customerPhone,
            serviceId = 0,
            serviceName = 'Serviço',
            serviceDuration = 30,
            servicePrice = 0
        } = req.body;

        // Validações
        if (!barberSlug || !date || !time || !customerName || !customerPhone) {
            return res.status(400).json({
                success: false,
                error: 'Todos os campos são obrigatórios'
            });
        }

        // Verificar se barbeiro existe
        const barberDoc = await db.collection('barbers').doc(barberSlug).get();
        if (!barberDoc.exists) {
            return res.status(404).json({ 
                success: false, 
                error: 'Barbeiro não encontrado' 
            });
        }

        // Verificar antecedência mínima
        const barberData = barberDoc.data();
        const bookingDateTime = new Date(`${date}T${time}:00`);
        const now = new Date();
        const hoursUntilBooking = (bookingDateTime - now) / (1000 * 60 * 60);
        
        const minAdvance = barberData.minAdvanceTime || 2;
        if (hoursUntilBooking < minAdvance) {
            return res.status(400).json({
                success: false,
                error: `Agendamento deve ser feito com pelo menos ${minAdvance} horas de antecedência`
            });
        }

        // ID único do agendamento
        const bookingId = `${barberSlug}_${date}_${time.replace(':', '')}`;

        // Verificar se horário já está ocupado
        const existingBooking = await db.collection('bookings').doc(bookingId).get();
        if (existingBooking.exists) {
            return res.status(400).json({
                success: false,
                error: 'Este horário já está ocupado'
            });
        }

        // Dados do agendamento
        const bookingData = {
            bookingId,
            barberSlug,
            date,
            time,
            customerName,
            customerPhone,
            serviceId,
            serviceName,
            serviceDuration,
            servicePrice,
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

// 5. Buscar agendamentos de um barbeiro
app.get('/api/barbers/:slug/bookings', async (req, res) => {
    try {
        const { slug } = req.params;
        const { date, status } = req.query;
        
        console.log(`📋 Buscando agendamentos para: ${slug}`);
        
        let query = db.collection('bookings').where('barberSlug', '==', slug);
        
        if (date) {
            query = query.where('date', '==', date);
        }
        
        if (status) {
            query = query.where('status', '==', status);
        }
        
        const snapshot = await query.get();
        
        const bookings = [];
        snapshot.forEach(doc => {
            bookings.push({ id: doc.id, ...doc.data() });
        });
        
        console.log(`✅ ${bookings.length} agendamentos encontrados`);
        
        res.json({
            success: true,
            data: bookings
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar agendamentos:', error);
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