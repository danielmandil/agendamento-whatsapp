const admin = require('firebase-admin');

try {
    let serviceAccount;
    
    // No Vercel, usa a variável de ambiente
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } else {
        // Localmente, usa o arquivo
        serviceAccount = require('./serviceAccountKey.json');
    }

    // Inicializa o Firebase Admin
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID
    });

    // Referência ao Firestore
    const db = admin.firestore();

    console.log('✅ Firebase conectado com sucesso!');

    module.exports = { admin, db };
} catch (error) {
    console.error('❌ Erro ao conectar Firebase:', error.message);
    throw error;
}