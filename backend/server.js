const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto'); // ✅ NOVO: Para gerar códigos seguros
const nodemailer = require('nodemailer'); // ✅ NOVO: Para envio de emails
require('dotenv').config();

// Importa configuração do Firebase
const { db } = require('./firebase-config');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ NOVO: Armazenamento temporário de códigos de login
const tempCodes = new Map();

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

// =============================================
// ✅ NOVAS ROTAS DE AUTENTICAÇÃO
// =============================================

// Rota para solicitar código de login
app.post('/api/auth/request-code', async (req, res) => {
    console.log('\n🔐 POST /api/auth/request-code RECEBIDO!');
    console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
    
    try {
        const { email } = req.body;
        
        if (!email) {
            console.log('❌ Email não fornecido');
            return res.status(400).json({
                success: false,
                error: 'Email é obrigatório'
            });
        }

        const emailLower = email.toLowerCase().trim();
        console.log('🔍 Procurando email:', emailLower);
        
        // Verificar se email existe no sistema
        const snapshot = await db.collection('barbers')
            .where('email', '==', emailLower)
            .get();
        
        if (snapshot.empty) {
            console.log('❌ Email não encontrado no sistema');
            return res.status(404).json({
                success: false,
                error: 'Email não encontrado no sistema. Verifique se você já criou sua barbearia.'
            });
        }
        
        // Pegar dados do barbeiro
        const barberDoc = snapshot.docs[0];
        const barberData = barberDoc.data();
        console.log('✅ Barbeiro encontrado:', barberData.businessName);
        
        // Gerar código de 6 dígitos
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        console.log('🔢 Código gerado:', code);
        
        // Salvar código temporariamente (5 minutos)
        const tempData = {
            code,
            email: emailLower,
            slug: barberData.slug,
            businessName: barberData.businessName,
            expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutos
        };
        
        tempCodes.set(emailLower, tempData);
        console.log('💾 Código salvo temporariamente');
        
        // Enviar email com código
        await sendLoginCode(emailLower, code, barberData.businessName);
        console.log('📧 Email enviado com sucesso');
        
        res.json({
            success: true,
            message: 'Código enviado para seu email. Verifique sua caixa de entrada.'
        });
        
    } catch (error) {
        console.error('❌ Erro ao enviar código:', error.message);
        console.error('Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor. Tente novamente.'
        });
    }
});

// Rota para verificar código
app.post('/api/auth/verify-code', async (req, res) => {
    console.log('\n🔐 POST /api/auth/verify-code RECEBIDO!');
    console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
    
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({
                success: false,
                error: 'Email e código são obrigatórios'
            });
        }

        const emailLower = email.toLowerCase().trim();
        console.log('🔍 Verificando código para:', emailLower);
        
        // Verificar se existe código temporário
        const tempData = tempCodes.get(emailLower);
        
        if (!tempData) {
            console.log('❌ Código não encontrado');
            return res.status(400).json({
                success: false,
                error: 'Código não encontrado ou expirado. Solicite um novo código.'
            });
        }
        
        // Verificar se código expirou
        if (Date.now() > tempData.expiresAt) {
            console.log('⏰ Código expirado');
            tempCodes.delete(emailLower);
            return res.status(400).json({
                success: false,
                error: 'Código expirado. Solicite um novo código.'
            });
        }
        
        // Verificar se código está correto
        if (tempData.code !== code.trim()) {
            console.log('❌ Código incorreto');
            return res.status(400).json({
                success: false,
                error: 'Código incorreto. Verifique e tente novamente.'
            });
        }
        
        console.log('✅ Código verificado com sucesso');
        
        // Código correto - limpar temporário
        tempCodes.delete(emailLower);
        
        // Retornar dados para redirecionamento
        res.json({
            success: true,
            data: {
                slug: tempData.slug,
                businessName: tempData.businessName,
                email: tempData.email
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao verificar código:', error.message);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor. Tente novamente.'
        });
    }
});

// ✅ ADICIONAR ESTA ROTA NO SEU server.js (após as outras rotas de auth)

// 6. Validar token (para o painel)
app.post('/api/auth/validate', async (req, res) => {
    console.log('\n🔐 POST /api/auth/validate RECEBIDO!');
    
    try {
        const authHeader = req.headers.authorization;
        const { email } = req.body;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Token não fornecido'
            });
        }
        
        const token = authHeader.substring(7); // Remove "Bearer "
        console.log('🔍 Validando token para email:', email);
        
        // Buscar o código ativo no Firebase
        const snapshot = await db.collection('auth_codes')
            .where('email', '==', email)
            .where('token', '==', token)
            .where('used', '==', true)
            .limit(1)
            .get();
        
        if (snapshot.empty) {
            console.log('❌ Token inválido ou expirado');
            return res.status(401).json({
                success: false,
                error: 'Token inválido'
            });
        }
        
        const authDoc = snapshot.docs[0].data();
        
        // Verificar se ainda está dentro do prazo (24 horas)
        const now = new Date();
        const loginTime = new Date(authDoc.usedAt);
        const hoursElapsed = (now - loginTime) / (1000 * 60 * 60);
        
        if (hoursElapsed > 24) {
            console.log('❌ Sessão expirada');
            return res.status(401).json({
                success: false,
                error: 'Sessão expirada'
            });
        }
        
        // Buscar dados do barbeiro pelo email
        const barbersSnapshot = await db.collection('barbers')
            .where('email', '==', email)
            .limit(1)
            .get();
        
        if (barbersSnapshot.empty) {
            console.log('❌ Barbeiro não encontrado para este email');
            return res.status(404).json({
                success: false,
                error: 'Barbeiro não encontrado'
            });
        }
        
        const barberData = barbersSnapshot.docs[0].data();
        
        console.log('✅ Token válido para:', email);
        
        res.json({
            success: true,
            data: {
                email: email,
                slug: barberData.slug,
                businessName: barberData.businessName
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao validar token:', error);
        res.status(500).json({
            success: false,
            error: 'Erro interno do servidor'
        });
    }
});

// =============================================
// ✅ FUNÇÃO PARA ENVIAR EMAIL VIA GMAIL
// =============================================

async function sendLoginCode(email, code, businessName) {
    try {
        console.log('📧 Configurando transporter do Gmail...');
        
        // Verificar se credenciais estão configuradas
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.warn('⚠️ Credenciais de email não configuradas. Email será simulado.');
            console.log(`📧 EMAIL SIMULADO para ${email}:`);
            console.log(`Assunto: Código de acesso - ${businessName}`);
            console.log(`Código: ${code}`);
            console.log('---');
            return;
        }
        
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        });
        
        const mailOptions = {
            from: `"Sistema de Agendamento" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `🔐 Código de acesso - ${businessName}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="text-align: center; margin-bottom: 30px;">
                        <h1 style="color: #333; margin-bottom: 10px;">🔐 Código de Acesso</h1>
                        <p style="color: #666; font-size: 16px;">
                            Você solicitou acesso ao painel da <strong>${businessName}</strong>
                        </p>
                    </div>
                    
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                                padding: 30px; 
                                text-align: center; 
                                margin: 30px 0; 
                                border-radius: 12px; 
                                box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
                        <h1 style="color: white; 
                                   font-size: 36px; 
                                   margin: 0; 
                                   letter-spacing: 8px; 
                                   font-weight: bold;
                                   text-shadow: 0 2px 4px rgba(0,0,0,0.3);">${code}</h1>
                        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 14px;">
                            Digite este código no painel
                        </p>
                    </div>
                    
                    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h3 style="color: #495057; margin-top: 0;">ℹ️ Informações importantes:</h3>
                        <ul style="color: #6c757d; padding-left: 20px;">
                            <li>Este código é válido por <strong>5 minutos</strong></li>
                            <li>Use apenas no site oficial do sistema</li>
                            <li>Não compartilhe este código com ninguém</li>
                        </ul>
                    </div>
                    
                    <div style="border-top: 1px solid #dee2e6; padding-top: 20px; margin-top: 30px;">
                        <p style="color: #868e96; font-size: 12px; text-align: center; margin: 0;">
                            Se você não solicitou este código, pode ignorar este email com segurança.
                        </p>
                    </div>
                </div>
            `
        };
        
        console.log('📧 Enviando email...');
        await transporter.sendMail(mailOptions);
        console.log('✅ Email enviado com sucesso');
        
    } catch (error) {
        console.error('❌ Erro ao enviar email:', error.message);
        
        // Em caso de erro, simular envio
        console.log(`📧 EMAIL SIMULADO (ERRO) para ${email}:`);
        console.log(`Código: ${code}`);
        console.log('---');
    }
}

// ✅ ADICIONAR ESTA ROTA NO server.js (após as outras rotas de barbeiros)

// Buscar barbeiro por email (para autenticação)
app.get('/api/barbers/by-email/:email', async (req, res) => {
    console.log(`📥 GET /api/barbers/by-email/${req.params.email}`);
    
    try {
        const email = decodeURIComponent(req.params.email).toLowerCase().trim();
        
        const snapshot = await db.collection('barbers')
            .where('email', '==', email)
            .limit(1)
            .get();
        
        if (snapshot.empty) {
            return res.status(404).json({ 
                success: false, 
                error: 'Barbeiro não encontrado para este email' 
            });
        }
        
        const barberDoc = snapshot.docs[0];
        const barberData = barberDoc.data();
        
        res.json({
            success: true,
            data: {
                slug: barberData.slug,
                email: barberData.email,
                businessName: barberData.businessName
            }
        });
        
    } catch (error) {
        console.error('❌ Erro ao buscar barbeiro por email:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// =============================================
// ROTAS EXISTENTES (mantidas como estavam)
// =============================================

// Teste simples
app.get('/api/test', (req, res) => {
    res.json({ message: 'API funcionando!' });
});

// 1. Criar novo barbeiro - VERSÃO ATUALIZADA COM EMAIL
app.post('/api/barbers', async (req, res) => {
    console.log('\n🚨 POST /api/barbers RECEBIDO!');
    console.log('📦 Dados recebidos:', JSON.stringify(req.body, null, 2));
    
    try {
        const {
            businessName,
            whatsapp,
            email, // ✅ NOVO CAMPO
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
        if (!businessName || !whatsapp || !email) { // ✅ EMAIL OBRIGATÓRIO
            console.log('❌ Dados obrigatórios faltando');
            return res.status(400).json({
                success: false,
                error: 'Nome da barbearia, WhatsApp e email são obrigatórios'
            });
        }

        // ✅ VALIDAÇÃO DE EMAIL
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                error: 'Email deve ter um formato válido'
            });
        }

        // ✅ VERIFICAR SE EMAIL JÁ EXISTE
        const emailLower = email.toLowerCase().trim();
        const existingEmailSnapshot = await db.collection('barbers')
            .where('email', '==', emailLower)
            .get();
        
        if (!existingEmailSnapshot.empty) {
            return res.status(400).json({
                success: false,
                error: 'Este email já está sendo usado por outra barbearia'
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
        const baseSlug = businessName
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .trim();

        // ✅ VERIFICAR SE SLUG JÁ EXISTE E GERAR ÚNICO
        let slug = baseSlug;
        let counter = 1;
        
        while (true) {
            const existingSlugSnapshot = await db.collection('barbers').doc(slug).get();
            if (!existingSlugSnapshot.exists) {
                break;
            }
            slug = `${baseSlug}-${counter}`;
            counter++;
        }

        // Dados do barbeiro
        const barberData = {
            businessName,
            whatsapp,
            email: emailLower, // ✅ NOVO CAMPO
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
        console.log('   Email:', emailLower);

        await db.collection('barbers').doc(slug).set(barberData);

        console.log('✅ SALVO COM SUCESSO!\n');

        // Detectar ambiente
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
        
        const barberDoc = await db.collection('barbers').doc(barberSlug).get();
        if (!barberDoc.exists) {
            return res.status(404).json({ 
                success: false, 
                error: 'Barbeiro não encontrado' 
            });
        }
        
        const barberData = barberDoc.data();
        
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

app.get('/painel-debug', (req, res) => {
    res.sendFile(path.join(frontendPath, 'painel-debug.html'));
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
    console.log(`   Painel: http://localhost:${PORT}/painel.html`);
    console.log(`   API Test: http://localhost:${PORT}/api/test`);
    console.log('========================================');
    console.log('📧 Para ativar emails, configure no .env:');
    console.log('   EMAIL_USER=seu-email@gmail.com');
    console.log('   EMAIL_PASS=sua-senha-de-app');
    console.log('========================================\n');
});