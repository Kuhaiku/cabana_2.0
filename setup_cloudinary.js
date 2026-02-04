// ARQUIVO: setup_cloudinary.js
require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

async function organizarCloudinary() {
    console.log("☁️  Organizando pastas no Cloudinary...");

    // Estrutura hierárquica (Pasta/Subpasta)
    const pastas = [
        "cabana/assets",       // Assets fixos (tendas, itens)
        "cabana/galeria",      // Fotos do carrossel
        "cabana/depoimentos"   // Uploads dos clientes
    ];

    for (const pasta of pastas) {
        try {
            const result = await cloudinary.api.create_folder(pasta);
            if (result.success) {
                console.log(`✅ Pasta criada: /${pasta}`);
            }
        } catch (error) {
            if (error.error && error.error.message.includes("folder already exists")) {
                console.log(`ℹ️  Pasta já existe: /${pasta}`);
            } else {
                console.error(`❌ Erro ao criar /${pasta}:`, error.message);
            }
        }
    }
    
    console.log("\n⚠️  PRÓXIMO PASSO: Mova suas imagens:");
    console.log("   - Assets do simulador -> cabana/assets");
    console.log("   - Fotos para o site -> cabana/galeria");
}

organizarCloudinary();