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
        const {
            businessName,
            whatsapp,
            address = '',
            openTime,
            closeTime,
            bufferTime = 10,
            workingDays = [1,2,3,4,5,6],
            services = [],
            minAdvanceTime = 2,
            maxBookingsPerDay = 0,
            hasLunchBreak = false,
            lunchStart = null,
            lunchEnd = null,
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

        // Se não tiver serviços, criar um padrão
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

        // Gerar slug único
        const slug = businessName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .trim();

        // Dados do barbeiro
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
            serviceDuration: finalServices[0]?.duration || 30
        };

        console.log('💾 Salvando no Firebase...');
        console.log('   Slug:', slug);

        // Salva no Firebase
        await db.collection('barbers').doc(slug).set(barberData);

        console.log('✅ SALVO COM SUCESSO!\n');

        // Detecta se está em produção
        let baseUrl;

        if (process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production') {
            baseUrl = 'https://agendamento-whatsapp.vercel.app';
        } else if (process.env.VERCEL_URL) {
            baseUrl = `https://${process.env.VERCEL_URL}`;
        } else {
            baseUrl = `http://localhost:${PORT}`;
        }

        console.log('🔗 Base URL detectada:', baseUrl);

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

// 3. Buscar horários disponíveis
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
        
        // Verificar se o dia está bloqueado
        const blockedDoc = await db.collection('blocked_dates')
            .where('barberSlug', '==', barberSlug)
            .where('date', '==', date)
            .get();
        
        if (!blockedDoc.empty) {
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
                message: 'Este dia está bloqueado para agendamentos'
            });
        }
        
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

// 4. Criar agendamento
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

        // Verificar se o dia está bloqueado
        const blockedDoc = await db.collection('blocked_dates')
            .where('barberSlug', '==', barberSlug)
            .where('date', '==', date)
            .get();
        
        if (!blockedDoc.empty) {
            return res.status(400).json({
                success: false,
                error: 'Esta data está bloqueada para agendamentos'
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

// ✅ 6. NOVA ROTA: Buscar datas bloqueadas
app.get('/api/barbers/:slug/blocked-dates', async (req, res) => {
    try {
        const { slug } = req.params;
        
        console.log(`🚫 Buscando datas bloqueadas para: ${slug}`);
        
        const snapshot = await db.collection('blocked_dates')
            .where('barberSlug', '==', slug)
            .get();
        
        const blockedDates = [];
        snapshot.forEach(doc => {
            blockedDates.push(doc.data().date);
        });
        
        console.log(`✅ ${blockedDates.length} datas bloqueadas encontradas`);
        
        res.json({
            success: true,
            data: blockedDates
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar datas bloqueadas:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ✅ 7. NOVA ROTA: Bloquear/Desbloquear datas
app.post('/api/blocked-dates', async (req, res) => {
    console.log('\n🚫 POST /api/blocked-dates RECEBIDO!');
    console.log('📦 Dados:', JSON.stringify(req.body, null, 2));
    
    try {
        const { barberSlug, date, action } = req.body;

        // Validações
        if (!barberSlug || !date || !action) {
            return res.status(400).json({
                success: false,
                error: 'Todos os campos são obrigatórios (barberSlug, date, action)'
            });
        }

        if (!['block', 'unblock'].includes(action)) {
            return res.status(400).json({
                success: false,
                error: 'Ação deve ser "block" ou "unblock"'
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

        const blockedDateId = `${barberSlug}_${date}`;

        if (action === 'block') {
            // Bloquear data
            const blockedDateData = {
                barberSlug,
                date,
                blockedAt: new Date().toISOString()
            };

            await db.collection('blocked_dates').doc(blockedDateId).set(blockedDateData);
            
            console.log(`✅ Data ${date} bloqueada para ${barberSlug}`);

            res.json({
                success: true,
                message: 'Data bloqueada com sucesso',
                data: blockedDateData
            });

        } else {
            // Desbloquear data
            await db.collection('blocked_dates').doc(blockedDateId).delete();
            
            console.log(`✅ Data ${date} desbloqueada para ${barberSlug}`);

            res.json({
                success: true,
                message: 'Data desbloqueada com sucesso'
            });
        }

    } catch (error) {
        console.error('❌ Erro ao gerenciar data bloqueada:', error);
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

// ✅ 8. NOVA ROTA: Deletar agendamento
app.delete('/api/bookings/:bookingId', async (req, res) => {
    console.log('\n🗑️ DELETE /api/bookings RECEBIDO!');
    console.log('📦 BookingId:', req.params.bookingId);
    
    try {
        const { bookingId } = req.params;

        // Validações
        if (!bookingId) {
            return res.status(400).json({
                success: false,
                error: 'ID do agendamento é obrigatório'
            });
        }

        // Verificar se agendamento existe
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({ 
                success: false, 
                error: 'Agendamento não encontrado' 
            });
        }

        const bookingData = bookingDoc.data();

        // Deletar agendamento
        await db.collection('bookings').doc(bookingId).delete();
        
        console.log(`✅ Agendamento ${bookingId} deletado com sucesso`);

        res.json({
            success: true,
            message: 'Agendamento deletado com sucesso',
            data: bookingData
        });

    } catch (error) {
        console.error('❌ Erro ao deletar agendamento:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ✅ 9. NOVA ROTA: Cancelar agendamento (mudar status)
app.patch('/api/bookings/:bookingId/cancel', async (req, res) => {
    console.log('\n❌ PATCH /api/bookings/cancel RECEBIDO!');
    console.log('📦 BookingId:', req.params.bookingId);
    
    try {
        const { bookingId } = req.params;

        // Validações
        if (!bookingId) {
            return res.status(400).json({
                success: false,
                error: 'ID do agendamento é obrigatório'
            });
        }

        // Verificar se agendamento existe
        const bookingDoc = await db.collection('bookings').doc(bookingId).get();
        if (!bookingDoc.exists) {
            return res.status(404).json({ 
                success: false, 
                error: 'Agendamento não encontrado' 
            });
        }

        // Atualizar status para cancelado
        await db.collection('bookings').doc(bookingId).update({
            status: 'cancelled',
            cancelledAt: new Date().toISOString()
        });
        
        console.log(`✅ Agendamento ${bookingId} cancelado com sucesso`);

        // Buscar dados atualizados
        const updatedDoc = await db.collection('bookings').doc(bookingId).get();

        res.json({
            success: true,
            message: 'Agendamento cancelado com sucesso',
            data: updatedDoc.data()
        });

    } catch (error) {
        console.error('❌ Erro ao cancelar agendamento:', error);
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