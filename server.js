require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Servir la SPA estática de coffeelab
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Estado de la sesión del SII
let siiBrowser = null;
let siiPage = null;
let cachedCookies = null;

// Helper para iniciar navegador
async function getBrowserInstance() {
  if (!siiBrowser) {
    siiBrowser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });
  }
  return siiBrowser;
}

// Endpoint 1: Iniciar Sesión en el SII / Obtener CAPTCHA si es necesario
app.post('/api/sii/login', async (req, res) => {
  const { rut, clave } = req.body;

  if (!rut || !clave) {
    return res.status(400).json({ success: false, message: 'RUT y Clave Tributaria son requeridos.' });
  }

  try {
    const browser = await getBrowserInstance();
    
    // Si ya hay una página abierta, la cerramos para iniciar limpio
    if (siiPage) {
      await siiPage.close().catch(() => {});
    }

    siiPage = await browser.newPage();
    
    // Establecer viewport móvil para que cargue la interfaz ligera de e-boleta
    await siiPage.setViewport({ width: 375, height: 667 });

    console.log('Navegando a e-boleta SII...');
    await siiPage.goto('https://eboleta.sii.cl/', { waitUntil: 'networkidle2', timeout: 30000 });

    // Esperar a que carguen los campos de login (redirección a SSO Hércules / zeusr)
    console.log('Esperando campos de login...');
    await siiPage.waitForSelector('input[name="rut"], input[id="rutcntr"], input[name="txt_rut"], #rut', { timeout: 15000 });

    // Desglosar el RUT en cuerpo y dígito verificador para admitir ambos formatos
    const cleanRut = rut.replace(/[^0-9kK]/g, '');
    const rutBody = cleanRut.slice(0, -1);
    const rutDv = cleanRut.slice(-1);

    const splitRutInput = await siiPage.$('input[name="txt_rut"], #txt_rut');
    const singleRutInput = await siiPage.$('input[name="rut"], input[id="rutcntr"], #rut');
    const claveInput = await siiPage.$('input[name="clave"], #clave, input[type="password"]');

    if (splitRutInput) {
      console.log('Escribiendo en campos divididos (RUT + DV)...');
      await splitRutInput.click({ clickCount: 3 });
      await splitRutInput.press('Backspace');
      await splitRutInput.type(rutBody);

      const dvInput = await siiPage.$('input[name="txt_dv"], #txt_dv');
      if (dvInput) {
        await dvInput.click({ clickCount: 3 });
        await dvInput.press('Backspace');
        await dvInput.type(rutDv);
      }
    } else if (singleRutInput) {
      console.log('Escribiendo en campo de RUT único...');
      await singleRutInput.click({ clickCount: 3 });
      await singleRutInput.press('Backspace');
      await singleRutInput.type(cleanRut);
    }

    if (claveInput) {
      await claveInput.click({ clickCount: 3 });
      await claveInput.press('Backspace');
      await claveInput.type(clave);
    }

    // Verificar si hay CAPTCHA visible de inmediato
    const captchaImg = await siiPage.$('img[src*="captcha"], #imgCaptcha, img[id*="captcha"]');
    if (captchaImg) {
      console.log('CAPTCHA detectado al inicio.');
      const captchaBase64 = await captchaImg.screenshot({ encoding: 'base64' });
      return res.json({
        success: true,
        status: 'captcha_required',
        captchaImg: `data:image/png;base64,${captchaBase64}`
      });
    }

    // Si no hay captcha inmediato, intentamos clickear en ingresar
    console.log('Intentando ingresar sin CAPTCHA...');
    const submitBtn = await siiPage.$('button[type="submit"], #bt_ingresar, input[type="submit"]');
    await submitBtn.click();

    // Esperar navegación o aparición de CAPTCHA por reintento
    await siiPage.waitForNetworkIdle({ idleTime: 500, timeout: 5000 }).catch(() => {});

    // Volver a verificar si saltó un CAPTCHA por error de credenciales o seguridad
    const postCaptchaImg = await siiPage.$('img[src*="captcha"], #imgCaptcha, img[id*="captcha"]');
    if (postCaptchaImg) {
      console.log('CAPTCHA requerido después del primer intento.');
      const captchaBase64 = await postCaptchaImg.screenshot({ encoding: 'base64' });
      return res.json({
        success: true,
        status: 'captcha_required',
        captchaImg: `data:image/png;base64,${captchaBase64}`
      });
    }

    // Verificar si ingresó exitosamente (la URL debería cambiar a eboleta o mostrar dashboard)
    const currentUrl = siiPage.url();
    if (currentUrl.includes('eboleta') || currentUrl.includes('menu')) {
      console.log('Login exitoso directo.');
      cachedCookies = await siiPage.cookies();
      return res.json({ success: true, status: 'connected' });
    } else {
      // Si sigue en la misma página de login, podría ser clave incorrecta
      return res.json({ success: false, message: 'No se pudo iniciar sesión. Verifique sus credenciales.' });
    }

  } catch (error) {
    console.error('Error en login SII:', error);
    res.status(500).json({ success: false, message: 'Error interno de comunicación con el SII: ' + error.message });
  }
});

// Endpoint 2: Resolver CAPTCHA
app.post('/api/sii/solve-captcha', async (req, res) => {
  const { captchaText } = req.body;

  if (!captchaText) {
    return res.status(400).json({ success: false, message: 'El texto del CAPTCHA es requerido.' });
  }

  if (!siiPage) {
    return res.status(400).json({ success: false, message: 'No hay sesión de login activa para resolver CAPTCHA.' });
  }

  try {
    console.log('Ingresando código CAPTCHA:', captchaText);
    
    // Escribir en el campo del captcha
    const captchaInput = await siiPage.$('input[name="captcha"], #txtCaptcha, input[placeholder*="captcha" i]');
    if (!captchaInput) {
      return res.status(400).json({ success: false, message: 'No se encontró el campo para escribir el CAPTCHA.' });
    }

    await captchaInput.click({ clickCount: 3 });
    await captchaInput.press('Backspace');
    await captchaInput.type(captchaText);

    // Click en ingresar
    const submitBtn = await siiPage.$('button[type="submit"], #bt_ingresar, input[type="submit"]');
    await submitBtn.click();

    // Esperar a que resuelva la autenticación
    console.log('Esperando autenticación del portal...');
    await siiPage.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});

    const currentUrl = siiPage.url();
    if (currentUrl.includes('eboleta') || currentUrl.includes('menu') || currentUrl.includes('hce')) {
      console.log('Sesión iniciada con éxito tras resolver CAPTCHA.');
      cachedCookies = await siiPage.cookies();
      return res.json({ success: true, status: 'connected' });
    }

    // Si falló y volvió a salir otro CAPTCHA
    const newCaptchaImg = await siiPage.$('img[src*="captcha"], #imgCaptcha, img[id*="captcha"]');
    if (newCaptchaImg) {
      console.log('CAPTCHA incorrecto, se requiere un nuevo intento.');
      const captchaBase64 = await newCaptchaImg.screenshot({ encoding: 'base64' });
      return res.json({
        success: false,
        status: 'captcha_required',
        message: 'Código incorrecto. Intente con el nuevo CAPTCHA.',
        captchaImg: `data:image/png;base64,${captchaBase64}`
      });
    }

    return res.status(400).json({ success: false, message: 'No se pudo iniciar sesión. Verifique RUT, Clave o CAPTCHA.' });

  } catch (error) {
    console.error('Error al resolver CAPTCHA:', error);
    res.status(500).json({ success: false, message: 'Error al procesar CAPTCHA: ' + error.message });
  }
});

// Endpoint 3: Consultar Estado de la Conexión
app.get('/api/sii/status', async (req, res) => {
  if (!siiPage) {
    return res.json({ connected: false });
  }
  
  try {
    const url = siiPage.url();
    const isLogged = url.includes('eboleta') || url.includes('menu') || url.includes('hce');
    return res.json({ connected: isLogged, url: url });
  } catch (e) {
    return res.json({ connected: false });
  }
});

// Endpoint 4: Emitir e-boleta en el SII
app.post('/api/sii/emitir', async (req, res) => {
  const { total } = req.body;

  if (!total || isNaN(total) || total <= 0) {
    return res.status(400).json({ success: false, message: 'Monto total de venta no válido.' });
  }

  if (!siiPage) {
    return res.status(400).json({ success: false, message: 'No hay sesión de e-boleta activa en el SII. Inicie sesión primero.' });
  }

  try {
    console.log(`Iniciando emisión de boleta por un total de: $${total}`);

    // Asegurar que estamos en el formulario de emisión
    let url = siiPage.url();
    if (!url.includes('eboleta.sii.cl/emitir/')) {
      console.log('Navegando al formulario de emisión...');
      await siiPage.goto('https://eboleta.sii.cl/emitir/', { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    }

    // Buscar el input de monto en la e-boleta del SII
    console.log('Buscando campo de monto...');
    const inputMonto = await siiPage.waitForSelector('input[type="number"], input[placeholder="0"], .input-monto', { timeout: 10000 });
    
    if (!inputMonto) {
      return res.status(500).json({ success: false, message: 'No se encontró el campo para ingresar el monto en el portal del SII.' });
    }

    // Escribir el monto en el portal
    await inputMonto.click({ clickCount: 3 });
    await inputMonto.press('Backspace');
    await inputMonto.type(String(total));

    // Dar tiempo corto para que el framework del SII procese el evento del input
    await siiPage.evaluate((tot) => {
      const inp = document.querySelector('input[type="number"]') || document.querySelector('input[placeholder="0"]');
      if (inp) {
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        inp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, total);

    // Buscar y clickear el botón de emisión (ej: Emitir, Generar, Enviar)
    console.log('Buscando botón de emisión...');
    const emitBtn = await siiPage.evaluateHandle(() => {
      return Array.from(document.querySelectorAll('button')).find(btn => 
        btn.textContent.includes('Emitir') || 
        btn.textContent.includes('Generar') ||
        btn.textContent.includes('Aceptar') ||
        btn.className.includes('btn-emitir')
      );
    });

    if (emitBtn) {
      console.log('Emitiendo boleta...');
      await emitBtn.click();
      
      // Esperar la confirmación o la generación del PDF
      await siiPage.waitForNetworkIdle({ idleTime: 1000, timeout: 5000 }).catch(() => {});
      
      return res.json({ success: true, message: 'Boleta emitida con éxito en el SII.' });
    } else {
      return res.status(500).json({ success: false, message: 'No se encontró el botón de emisión en el portal del SII.' });
    }

  } catch (error) {
    console.error('Error al emitir boleta:', error);
    res.status(500).json({ success: false, message: 'Error durante la emisión en el SII: ' + error.message });
  }
});

// Endpoint para obtener la configuración de Supabase de forma segura
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || 'https://pvoucqjdcygndtqmksuv.supabase.co',
    supabaseKey: process.env.SUPABASE_KEY || 'sb_publishable_X31HUj1aCZdoWV8DHfhlEw_UVx7nPjL'
  });
});

app.listen(PORT, () => {
  console.log(`Servidor de coffeelab POS activo en puerto ${PORT}`);
});
