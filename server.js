require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Servir la SPA estática de coffeelab
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint para obtener la configuración de Supabase de forma segura
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || 'https://pvoucqjdcygndtqmksuv.supabase.co',
    supabaseKey: process.env.SUPABASE_KEY || 'sb_publishable_X31HUj1aCZdoWV8DHfhlEw_UVx7nPjL'
  });
});

// --- PROXY DE PAGOS TUU (HAULMER) ---

// Iniciar solicitud de pago remoto en el POS TUU
app.post('/api/tuu/pay', async (req, res) => {
  try {
    const { amount, device, description, apiKey, idempotencyKey } = req.body;
    
    if (!apiKey) return res.status(400).json({ error: 'Falta la API Key de TUU' });
    if (!device) return res.status(400).json({ error: 'Falta el Número de Serie de tu POS TUU' });
    if (!amount) return res.status(400).json({ error: 'Falta el Monto de la transacción' });
    if (!idempotencyKey) return res.status(400).json({ error: 'Falta el IdempotencyKey' });

    console.log(`Enviando cobro TUU remoto - POS: ${device}, Monto: $${amount}, IdempotencyKey: ${idempotencyKey}`);

    const response = await fetch('https://integrations.payment.haulmer.com/RemotePayment/v2/Create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({
        IdempotencyKey: idempotencyKey,
        Amount: Math.round(amount),
        Device: device,
        Description: description || 'Venta Punto 41 POS',
        DteType: 0
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      console.error('API de TUU retornó error:', data);
      return res.status(response.status).json({ error: data.message || 'Error retornado por la API de TUU' });
    }

    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Excepción en proxy de pago TUU:', error);
    return res.status(500).json({ error: 'Error de red o comunicación con la API de TUU: ' + error.message });
  }
});

// Consultar el estado del pago remoto mediante su IdempotencyKey
app.get('/api/tuu/status/:idempotencyKey', async (req, res) => {
  try {
    const { idempotencyKey } = req.params;
    const apiKey = req.headers['x-api-key'];

    if (!apiKey) return res.status(400).json({ error: 'Falta la API Key de TUU en los encabezados' });
    if (!idempotencyKey) return res.status(400).json({ error: 'Falta la clave de idempotencia' });

    const response = await fetch(`https://integrations.payment.haulmer.com/RemotePayment/v2/GetPaymentRequest/${idempotencyKey}`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Error al consultar estado en TUU' });
    }

    return res.status(response.status).json(data);
  } catch (error) {
    console.error('Excepción al consultar estado de pago TUU:', error);
    return res.status(500).json({ error: 'Error de red al consultar estado de TUU: ' + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor de coffeelab POS activo en puerto ${PORT}`);
});
