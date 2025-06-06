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

// ==================== ROTAS DA API ====================

// Teste simples
app.get('/api/test', (req, res) => {
    res.json({ message: 'API funcionando!' });
});

// ===== ROTAS DE BARBEIROS =====

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

        if (finalServices.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Configure pelo menos um serviço'
            });
        }

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
        await db.collection('barbers').doc(slug).set(barberData);
        console.log('✅ SALVO COM SUCESSO!\n');

        // Detectar URL base
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

// 3. Atualizar horários básicos do barbeiro
app.put('/api/barbers/:slug/schedule', async (req, res) => {
    try {
        const { slug } = req.params;
        const { openTime, closeTime } = req.body;
        
        console.log(`🕐 Atualizando horários para ${slug}:`, { openTime, closeTime });
        
        if (!openTime || !closeTime) {
            return res.status(400).json({
                success: false,
                error: 'Horários de abertura e fechamento são obrigatórios'
            });
        }
        
        if (parseInt(openTime) >= parseInt(closeTime)) {
            return res.status(400).json({
                success: false,
                error: 'Horário de abertura deve ser anterior ao fechamento'
            });
        }
        
        await db.collection('barbers').doc(slug).update({
            openTime: parseInt(openTime),
            closeTime: parseInt(closeTime),
            updatedAt: new Date().toISOString()
        });
        
        console.log('✅ Horários atualizados com sucesso');
        
        res.json({
            success: true,
            message: 'Horários atualizados com sucesso'
        });
        
    } catch (error) {
        console.error('❌ Erro ao atualizar horários:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 4. Atualizar dias de funcionamento
app.put('/api/barbers/:slug/working-days', async (req, res) => {
    try {
        const { slug } = req.params;
        const { workingDays } = req.body;
        
        console.log(`📆 Atualizando dias de funcionamento para ${slug}:`, workingDays);
        
        if (!Array.isArray(workingDays) || workingDays.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Selecione pelo menos um dia de funcionamento'
            });
        }
        
        await db.collection('barbers').doc(slug).update({
            workingDays: workingDays.map(day => parseInt(day)),
            updatedAt: new Date().toISOString()
        });
        
        console.log('✅ Dias de funcionamento atualizados');
        
        res.json({
            success: true,
            message: 'Dias de funcionamento atualizados'
        });
        
    } catch (error) {
        console.error('❌ Erro ao atualizar dias:', error);
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
        
        if (date) query = query.where('date', '==', date);
        if (status) query = query.where('status', '==', status);
        
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

// ===== ROTAS DE DISPONIBILIDADE =====

// 6. Buscar configurações de disponibilidade do barbeiro
app.get('/api/barbers/:slug/availability', async (req, res) => {
    try {
        const { slug } = req.params;
        
        console.log(`📅 Buscando disponibilidade para: ${slug}`);
        
        const barberDoc = await db.collection('barbers').doc(slug).get();
        if (!barberDoc.exists) {
            return res.status(404).json({ 
                success: false, 
                error: 'Barbeiro não encontrado' 
            });
        }
        
        const availabilitySnapshot = await db.collection('availability')
            .where('barberSlug', '==', slug)
            .get();
        
        const availabilityRules = [];
        availabilitySnapshot.forEach(doc => {
            availabilityRules.push({ id: doc.id, ...doc.data() });
        });
        
        res.json({
            success: true,
            data: {
                barber: barberDoc.data(),
                availabilityRules
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar disponibilidade:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 7. Criar/Atualizar regra de disponibilidade específica
app.post('/api/barbers/:slug/availability', async (req, res) => {
    try {
        const { slug } = req.params;
        const { 
            date, 
            type,
            blockedHours, 
            customOpenTime, 
            customCloseTime,
            reason 
        } = req.body;
        
        console.log(`🚫 Criando regra de disponibilidade:`, req.body);
        
        if (!date || !type) {
            return res.status(400).json({
                success: false,
                error: 'Data e tipo de bloqueio são obrigatórios'
            });
        }
        
        const ruleId = `${slug}_${date}_${type}`;
        
        const availabilityRule = {
            barberSlug: slug,
            date,
            type,
            blockedHours: blockedHours || [],
            customOpenTime: customOpenTime || null,
            customCloseTime: customCloseTime || null,
            reason: reason || '',
            createdAt: new Date().toISOString()
        };
        
        await db.collection('availability').doc(ruleId).set(availabilityRule);
        
        console.log('✅ Regra de disponibilidade criada:', ruleId);
        
        res.json({
            success: true,
            data: { id: ruleId, ...availabilityRule },
            message: 'Regra de disponibilidade criada'
        });
        
    } catch (error) {
        console.error('❌ Erro ao criar regra:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 8. Remover regra de disponibilidade
app.delete('/api/barbers/:slug/availability/:ruleId', async (req, res) => {
    try {
        const { slug, ruleId } = req.params;
        
        console.log(`🗑️ Removendo regra de disponibilidade: ${ruleId}`);
        
        const ruleDoc = await db.collection('availability').doc(ruleId).get();
        
        if (!ruleDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Regra não encontrada'
            });
        }
        
        const ruleData = ruleDoc.data();
        if (ruleData.barberSlug !== slug) {
            return res.status(403).json({
                success: false,
                error: 'Acesso negado'
            });
        }
        
        await db.collection('availability').doc(ruleId).delete();
        
        console.log('✅ Regra removida com sucesso');
        
        res.json({
            success: true,
            message: 'Regra removida com sucesso'
        });
        
    } catch (error) {
        console.error('❌ Erro ao remover regra:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// 9. Buscar disponibilidade para uma data específica
app.get('/api/barbers/:slug/availability/:date', async (req, res) => {
    try {
        const { slug, date } = req.params;
        
        console.log(`📅 Verificando disponibilidade para ${slug} em ${date}`);
        
        const availabilitySnapshot = await db.collection('availability')
            .where('barberSlug', '==', slug)
            .where('date', '==', date)
            .get();
        
        const rules = [];
        availabilitySnapshot.forEach(doc => {
            rules.push({ id: doc.id, ...doc.data() });
        });
        
        res.json({
            success: true,
            data: {
                date,
                rules,
                hasCustomRules: rules.length > 0
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao verificar disponibilidade:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ===== ROTAS DE AGENDAMENTOS =====

// 10. Buscar horários disponíveis
app.get('/api/bookings/:barberSlug/:date', async (req, res) => {
    console.log(`📥 GET /api/bookings/${req.params.barberSlug}/${req.params.date}`);
    
    try {
        const { barberSlug, date } = req.params;
        
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

// 11. Criar agendamento
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

        if (!barberSlug || !date || !time || !customerName || !customerPhone) {
            return res.status(400).json({
                success: false,
                error: 'Todos os campos são obrigatórios'
            });
        }

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

        const bookingId = `${barberSlug}_${date}_${time.replace(':', '')}`;

        const existingBooking = await db.collection('bookings').doc(bookingId).get();
        if (existingBooking.exists) {
            return res.status(400).json({
                success: false,
                error: 'Este horário já está ocupado'
            });
        }

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

// ===== ROTAS DE PÁGINAS =====

app.get('/setup', (req, res) => {
    res.sendFile(path.join(frontendPath, 'setup.html'));
});

app.get('/agendar', (req, res) => {
    res.sendFile(path.join(frontendPath, 'agendar.html'));
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