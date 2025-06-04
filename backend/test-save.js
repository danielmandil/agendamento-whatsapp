require('dotenv').config();
const { db } = require('./firebase-config');

async function testarSalvamento() {
    try {
        console.log('🔥 Testando salvamento direto...');
        
        const testData = {
            businessName: 'Teste Direto',
            whatsapp: '11555555555',
            openTime: 9,
            closeTime: 18,
            serviceDuration: 30,
            slug: 'teste-direto',
            createdAt: new Date().toISOString()
        };
        
        console.log('📝 Salvando:', testData);
        
        await db.collection('barbers').doc('teste-direto').set(testData);
        
        console.log('✅ Salvo com sucesso!');
        
        // Verifica se foi salvo
        const doc = await db.collection('barbers').doc('teste-direto').get();
        if (doc.exists) {
            console.log('✅ Verificado: Documento existe!');
            console.log('📄 Dados:', doc.data());
        } else {
            console.log('❌ Documento não encontrado após salvar!');
        }
        
    } catch (error) {
        console.error('❌ Erro:', error.message);
        console.error('Detalhes:', error);
    }
}

testarSalvamento();