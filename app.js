
/* ==========================================================================
   PUNTO 41 - SISTEMA DE GESTIÓN Y POS
   LÓGICA DE APLICACIÓN (SPA, STORAGE, POS, BÚSQUEDA, REPORTES, ROLES E IMPRESIÓN)
   ========================================================================== */

// --- ESTADO GLOBAL ---
let state = {
  products: [],
  clients: [],
  suppliers: [],
  sales: []
};

// --- CONFIGURACIÓN SUPABASE ---
let supabaseClient = null;

let cart = [];
let cartDiscount = { value: 0, type: 'percent' }; // percent o fixed
let selectedView = 'dashboard';
let salesChartInstance = null;
let currentReportRange = 'diario';
let activeRole = 'cajero'; // admin o cajero

// --- INICIALIZADOR Y SEED DATA (SEMILLA) ---
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  loadStateFromLocalStorage();
  
  // Inicializar selector de mes en reportes al mes actual
  const now = new Date();
  const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthPicker = document.getElementById('report-month-picker');
  if (monthPicker) {
    monthPicker.value = currentYearMonth;
  }
  
  setupEventListeners();
  updateCurrentDateDisplay();
  navigateTo(selectedView);
  checkLowStockAlerts();

  // Si no hay datos locales, sembrar datos de prueba iniciales de inmediato para no ver pantalla vacía
  const wasCleared = localStorage.getItem('p41_cleared');
  if (state.products.length === 0 && state.suppliers.length === 0 && !wasCleared) {
    seedData();
    renderAllViews();
  }

  // Inicializar Supabase de forma asíncrona en segundo plano sin congelar la app
  initSupabaseAsync();
}

async function initSupabaseAsync() {
  try {
    const resConfig = await fetch('/api/config').then(r => r.json());
    if (resConfig.supabaseUrl && resConfig.supabaseKey) {
      // Cargar Supabase CDN dinámicamente para evitar bloqueos del hilo principal
      await new Promise((resolve) => {
        if (window.supabase) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.head.appendChild(script);
      });

      if (window.supabase) {
        supabaseClient = window.supabase.createClient(resConfig.supabaseUrl, resConfig.supabaseKey);
      }
    }
  } catch (err) {
    console.warn('No se pudo obtener la configuración de Supabase desde el servidor, usando modo offline.');
  }

  if (supabaseClient) {
    loadStateFromSupabase();
  }
}

function loadStateFromLocalStorage() {
  const products = localStorage.getItem('p41_products');
  const clients = localStorage.getItem('p41_clients');
  const suppliers = localStorage.getItem('p41_suppliers');
  const sales = localStorage.getItem('p41_sales');

  state.products = products ? JSON.parse(products) : [];
  state.clients = clients ? JSON.parse(clients) : [];
  state.suppliers = suppliers ? JSON.parse(suppliers) : [];
  state.sales = sales ? JSON.parse(sales) : [];

  // CORRECCIÓN MIGRACIÓN: Recalcular iconos y colores para sincronizar con la base de datos extendida de iconos
  let needsSave = false;
  state.products.forEach(p => {
    const iconData = getProductIconData(p.name, p.category);
    if (p.icon !== iconData.icon || p.color !== iconData.color) {
      p.icon = iconData.icon;
      p.color = iconData.color;
      needsSave = true;
    }
  });

  // Asegurar que todos los clientes tengan inicializado el campo de puntos
  state.clients.forEach(c => {
    if (c.points === undefined) {
      c.points = 0;
      needsSave = true;
    }
  });

  if (needsSave) {
    saveStateToLocalStorage();
  }

  // Cargar preferencia de e-boleta activa
  const eboletaActive = localStorage.getItem('p41_eboleta_active') === 'true';
  const eboletaCheckbox = document.getElementById('settings-eboleta-active');
  if (eboletaCheckbox) {
    eboletaCheckbox.checked = eboletaActive;
  }

  const siiRut = localStorage.getItem('p41_sii_rut') || '';
  const siiClave = localStorage.getItem('p41_sii_clave') || '';
  const rutInput = document.getElementById('settings-sii-rut');
  const claveInput = document.getElementById('settings-sii-clave');
  if (rutInput) rutInput.value = siiRut;
  if (claveInput) claveInput.value = siiClave;

  // Verificar estado de conexión en la nube inicial
  if (eboletaActive) {
    setTimeout(checkSIIConnectionStatus, 1000);
  }
}

function saveStateToLocalStorage() {
  localStorage.setItem('p41_products', JSON.stringify(state.products));
  localStorage.setItem('p41_clients', JSON.stringify(state.clients));
  localStorage.setItem('p41_suppliers', JSON.stringify(state.suppliers));
  localStorage.setItem('p41_sales', JSON.stringify(state.sales));

  const eboletaCheckbox = document.getElementById('settings-eboleta-active');
  if (eboletaCheckbox) {
    localStorage.setItem('p41_eboleta_active', eboletaCheckbox.checked ? 'true' : 'false');
  }

  const rutInput = document.getElementById('settings-sii-rut');
  const claveInput = document.getElementById('settings-sii-clave');
  if (rutInput) localStorage.setItem('p41_sii_rut', rutInput.value);
  if (claveInput) localStorage.setItem('p41_sii_clave', claveInput.value);

  // Sincronizar en segundo plano con Supabase Cloud
  if (supabaseClient) {
    syncStateToSupabase();
  }
}

// Sembrar datos realistas de cafetería chilena
function seedData() {
  showToast('Sembrando datos de prueba iniciales...', 'info');

  // 1. Proveedores
  const seedSuppliers = [
    { id: 'prov-1', name: 'Tostaduría Café de Especialidad Origen S.A.', rut: '76.120.340-5', phone: '+56 2 2456 7890', email: 'contacto@cafeorigen.cl', address: 'Av. Italia 1024, Providencia, Santiago' },
    { id: 'prov-2', name: 'Distribuidora Pan y Dulce Rincón', rut: '77.890.120-K', phone: '+56 9 8765 4321', email: 'ventas@panydulce.cl', address: 'Las Condes 8840, Las Condes, Santiago' },
    { id: 'prov-3', name: 'Lácteos del Sur S.A.', rut: '96.540.320-1', phone: '+56 63 245 1122', email: 'pedidos@lacteosdelsur.cl', address: 'Camino Osorno Km 12, Osorno' },
    { id: 'prov-4', name: 'Bebidas y Jugos Frutales del Maipo', rut: '81.230.980-4', phone: '+56 2 2788 4400', email: 'ventas@frutalesmaipo.cl', address: 'Camino al Volcán 4500, Pirque' },
    { id: 'prov-5', name: 'Importadora Bazar & Menaje Punto 41', rut: '79.110.220-3', phone: '+56 2 2333 1111', email: 'bazar@punto41.cl', address: 'Av. Vitacura 5020, Vitacura' }
  ];
  state.suppliers = seedSuppliers;

  // 2. Clientes (Inicializados con puntos en 0)
  const seedClients = [
    { id: 'cli-1', name: 'Cristóbal Valenzuela', rut: '18.456.123-9', phone: '+56988887777', email: 'cristobal@gmail.com', points: 0, createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'cli-2', name: 'Catalina Soto', rut: '19.876.543-K', phone: '+56977776666', email: 'catalina.soto@uach.cl', points: 0, createdAt: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'cli-3', name: 'Roberto Muñoz', rut: '12.345.678-9', phone: '+56966665555', email: 'roberto.munoz@empresa.cl', points: 0, createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'cli-4', name: 'Fernanda Rojas', rut: '15.654.321-0', phone: '+56955554444', email: 'fer.rojas@outlook.com', points: 0, createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'cli-5', name: 'Ignacio Herrera', rut: '17.987.123-2', phone: '+56944443333', email: 'i.herrera@pyme.cl', points: 0, createdAt: new Date().toISOString() }
  ];
  state.clients = seedClients;

  // 3. Productos (Inventario)
  const seedProducts = [
    // Cafés
    { id: 'prod-1', name: 'Espresso Simple', sku: 'CAF-ESP-01', category: 'Café', stock: 45, minStock: 10, costPrice: 600, salePrice: 1800, supplierId: 'prov-1' },
    { id: 'prod-2', name: 'Espresso Doble', sku: 'CAF-ESP-02', category: 'Café', stock: 40, minStock: 10, costPrice: 900, salePrice: 2400, supplierId: 'prov-1' },
    { id: 'prod-3', name: 'Café Capuccino Grande', sku: 'CAF-CAP-03', category: 'Café', stock: 8, minStock: 12, costPrice: 1100, salePrice: 3200, supplierId: 'prov-1' },
    { id: 'prod-4', name: 'Café Latte Mediano', sku: 'CAF-LAT-04', category: 'Café', stock: 35, minStock: 10, costPrice: 1000, salePrice: 2900, supplierId: 'prov-1' },
    { id: 'prod-5', name: 'Café Americano Filtrado', sku: 'CAF-AME-05', category: 'Café', stock: 50, minStock: 10, costPrice: 700, salePrice: 2000, supplierId: 'prov-1' },
    
    // Té
    { id: 'prod-6', name: 'Té Verde Matcha Orgánico', sku: 'TEA-MAT-01', category: 'Té e Infusiones', stock: 2, minStock: 5, costPrice: 1200, salePrice: 3500, supplierId: 'prov-1' },
    { id: 'prod-7', name: 'Infusión Frutos Rojos', sku: 'TEA-ROJ-02', category: 'Té e Infusiones', stock: 25, minStock: 5, costPrice: 800, salePrice: 2600, supplierId: 'prov-1' },

    // Repostería
    { id: 'prod-8', name: 'Croissant Mantequilla Especial', sku: 'REP-CRO-01', category: 'Repostería', stock: 15, minStock: 5, costPrice: 950, salePrice: 2100, supplierId: 'prov-2' },
    { id: 'prod-9', name: 'Muffin de Arándanos Rústico', sku: 'REP-MUF-02', category: 'Repostería', stock: 12, minStock: 5, costPrice: 850, salePrice: 1950, supplierId: 'prov-2' },
    { id: 'prod-10', name: 'Tarta de Frambuesas y Pistacho', sku: 'REP-TAR-03', category: 'Repostería', stock: 4, minStock: 3, costPrice: 1800, salePrice: 3800, supplierId: 'prov-2' },

    // Sándwiches
    { id: 'prod-11', name: 'Sándwich Jamón Queso Calentito', sku: 'SAN-JAM-01', category: 'Sándwiches', stock: 18, minStock: 5, costPrice: 1400, salePrice: 3400, supplierId: 'prov-2' },
    { id: 'prod-12', name: 'Ciabatta de Carne Mechada y Queso', sku: 'SAN-MEC-02', category: 'Sándwiches', stock: 10, minStock: 4, costPrice: 2500, salePrice: 5500, supplierId: 'prov-2' },

    // Bebidas Frías
    { id: 'prod-13', name: 'Jugo Naranja Natural Exprimido', sku: 'BEB-JUG-01', category: 'Bebidas Frías', stock: 22, minStock: 6, costPrice: 1000, salePrice: 2800, supplierId: 'prov-4' },
    { id: 'prod-14', name: 'Coca Cola Zero Lata 350cc', sku: 'BEB-COC-02', category: 'Bebidas Frías', stock: 48, minStock: 12, costPrice: 650, salePrice: 1500, supplierId: 'prov-4' },

    // Accesorios
    { id: 'prod-15', name: 'Vaso Térmico Punto 41', sku: 'ACC-VAS-01', category: 'Accesorios', stock: 15, minStock: 3, costPrice: 4000, salePrice: 9990, supplierId: 'prov-5' }
  ];
  
  // Agregar figuras vectoriales (icono + color de fondo plano) a productos semilla
  seedProducts.forEach(p => {
    const iconData = getProductIconData(p.name, p.category);
    p.icon = iconData.icon;
    p.color = iconData.color;
  });
  
  state.products = seedProducts;

  // 4. Ventas Históricas (Simular últimos 12 meses)
  const seedSales = [];
  const now = new Date();
  const salesCount = 80;
  const methods = ['efectivo', 'tarjeta', 'transferencia'];
  
  for (let i = 0; i < salesCount; i++) {
    let saleDate = new Date();
    if (i < 6) {
      saleDate.setHours(8 + Math.floor(Math.random() * 11), Math.floor(Math.random() * 60), 0);
    } else if (i < 18) {
      const daysAgo = 1 + Math.floor(Math.random() * 6);
      saleDate.setDate(now.getDate() - daysAgo);
      saleDate.setHours(8 + Math.floor(Math.random() * 11), Math.floor(Math.random() * 60), 0);
    } else if (i < 38) {
      const daysAgo = 7 + Math.floor(Math.random() * 22);
      saleDate.setDate(now.getDate() - daysAgo);
      saleDate.setHours(8 + Math.floor(Math.random() * 11), Math.floor(Math.random() * 60), 0);
    } else {
      const monthsAgo = 1 + Math.floor(Math.random() * 11);
      saleDate.setMonth(now.getMonth() - monthsAgo);
      saleDate.setDate(1 + Math.floor(Math.random() * 28));
      saleDate.setHours(8 + Math.floor(Math.random() * 11), Math.floor(Math.random() * 60), 0);
    }

    if (saleDate > now) {
      saleDate = new Date(now.getTime() - i * 15 * 60 * 1000);
    }

    const client = Math.random() > 0.5 ? seedClients[Math.floor(Math.random() * seedClients.length)] : null;
    
    const items = [];
    const itemsCount = 1 + Math.floor(Math.random() * 3);
    let subtotal = 0;
    
    const selectedProdIds = [];
    for (let k = 0; k < itemsCount; k++) {
      let prod = seedProducts[Math.floor(Math.random() * seedProducts.length)];
      while (selectedProdIds.includes(prod.id)) {
        prod = seedProducts[Math.floor(Math.random() * seedProducts.length)];
      }
      selectedProdIds.push(prod.id);

      const quantity = 1 + Math.floor(Math.random() * 2);
      
      let discount = 0;
      let discountType = 'percent';
      if (Math.random() > 0.85) {
        discount = Math.random() > 0.5 ? 10 : 20;
      }

      const originalPrice = prod.salePrice;
      const finalPrice = discount > 0 ? originalPrice * (1 - discount / 100) : originalPrice;
      const totalItem = finalPrice * quantity;
      subtotal += originalPrice * quantity;

      items.push({
        productId: prod.id,
        name: prod.name,
        quantity: quantity,
        price: originalPrice,
        discount: discount,
        discountType: discountType,
        total: totalItem
      });
    }

    let discountTotal = 0;
    let discountType = 'percent';
    if (Math.random() > 0.9) {
      discountTotal = 10;
    }

    const itemsTotal = items.reduce((sum, item) => sum + item.total, 0);
    const finalTotal = discountTotal > 0 ? itemsTotal * (1 - discountTotal / 100) : itemsTotal;

    const finalSale = {
      id: 'V-' + (1000 + i),
      date: saleDate.toISOString(),
      clientId: client ? client.id : null,
      items: items,
      discountTotal: discountTotal,
      discountType: discountType,
      subtotal: subtotal,
      total: Math.round(finalTotal),
      paymentMethod: methods[Math.floor(Math.random() * methods.length)],
      pointsRedeemed: 0,
      pointsEarned: Math.floor(Math.round(finalTotal) / 1000) * 100,
      clientPointsBalance: 0
    };

    seedSales.push(finalSale);
  }

  seedSales.sort((a, b) => new Date(a.date) - new Date(b.date));
  state.sales = seedSales;

  // Calcular puntos acumulados de los clientes en base al historial de ventas sembrado
  state.sales.forEach(sale => {
    if (sale.clientId) {
      const client = state.clients.find(c => c.id === sale.clientId);
      if (client) {
        client.points += sale.pointsEarned;
        sale.clientPointsBalance = client.points;
      }
    }
  });

  saveStateToLocalStorage();
  showToast('Datos de prueba cargados con éxito.', 'success');
}

// --- MANEJADOR DE EVENTOS GLOBALES ---
function setupEventListeners() {
  // SPA Menu Navigation
  document.querySelectorAll('.menu-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const target = item.getAttribute('data-target');
      navigateTo(target);
    });
  });

  // GESTIÓN DE ROLES / PERFILES
  document.getElementById('app-role-select').addEventListener('change', (e) => {
    const chosenRole = e.target.value;
    if (chosenRole === 'admin') {
      clearPasscode();
      document.getElementById('passcode-modal').classList.add('active');
    } else {
      activeRole = chosenRole;
      applyRoleRestrictions();
      showToast(`Perfil cambiado a: ${capitalize(activeRole)}`, 'info');
    }
  });

  // BOTONES NUEVOS REGISTROS
  document.getElementById('btn-new-product').addEventListener('click', () => {
    if (checkPermission()) openProductModal();
  });
  document.getElementById('btn-new-client').addEventListener('click', () => openClientModal());
  document.getElementById('btn-new-supplier').addEventListener('click', () => {
    if (checkPermission()) openSupplierModal();
  });
  
  // POS ACCIONES
  document.getElementById('pos-add-client-quick').addEventListener('click', () => {
    openClientModal();
  });
  document.getElementById('btn-clear-cart').addEventListener('click', () => {
    clearCart();
  });
  document.getElementById('btn-add-cart-discount').addEventListener('click', () => {
    openDiscountModal('cart', 'all');
  });
  document.getElementById('btn-remove-cart-discount').addEventListener('click', () => {
    removeCartDiscount();
  });
  document.getElementById('btn-checkout').addEventListener('click', () => {
    executeCheckout();
  });

  // MANEJO DE SELECCIÓN DE CLIENTE Y PUNTOS EN EL POS
  document.getElementById('pos-client-select').addEventListener('change', (e) => {
    handlePOSClientChange(e.target.value);
    syncPOSClientSearch();
  });
  document.getElementById('pos-use-points-checkbox').addEventListener('change', () => {
    renderCart();
  });

  // BÚSQUEDA INTERACTIVA DE CLIENTE EN TICKET
  const clientSearchInput = document.getElementById('pos-client-search');
  if (clientSearchInput) {
    clientSearchInput.addEventListener('input', (e) => {
      filterPOSClients(e.target.value);
    });
    clientSearchInput.addEventListener('focus', (e) => {
      filterPOSClients(e.target.value);
    });
  }

  const clientClearBtn = document.getElementById('pos-client-clear-btn');
  if (clientClearBtn) {
    clientClearBtn.addEventListener('click', () => {
      const select = document.getElementById('pos-client-select');
      if (select) {
        select.value = '';
        handlePOSClientChange('');
      }
      syncPOSClientSearch();
      const results = document.getElementById('pos-client-results');
      if (results) results.style.display = 'none';
    });
  }

  // Cerrar resultados de cliente al hacer clic fuera
  document.addEventListener('click', (e) => {
    const results = document.getElementById('pos-client-results');
    const searchInput = document.getElementById('pos-client-search');
    if (results && searchInput && e.target !== searchInput && !results.contains(e.target)) {
      results.style.display = 'none';
    }
  });

  // MANEJO DE MÉTODO DE PAGO Y VUELTO EN EFECTIVO
  document.querySelectorAll('input[name="payment-method"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      const calcArea = document.getElementById('cash-change-calculator');
      if (calcArea) {
        if (e.target.value === 'efectivo') {
          calcArea.style.display = 'block';
        } else {
          calcArea.style.display = 'none';
        }
      }
      updateCashChange();
    });
  });

  const cashReceivedInput = document.getElementById('pos-cash-received');
  if (cashReceivedInput) {
    cashReceivedInput.addEventListener('input', () => {
      updateCashChange();
    });
  }

  // SUBMIT FORMULARIOS MODALES
  document.getElementById('product-form').addEventListener('submit', handleProductFormSubmit);
  document.getElementById('client-form').addEventListener('submit', handleClientFormSubmit);
  document.getElementById('supplier-form').addEventListener('submit', handleSupplierFormSubmit);
  document.getElementById('discount-form').addEventListener('submit', handleDiscountFormSubmit);

  // VISTA PREVIA INTERACTIVA DE ICONOS AL CREAR/EDITAR PRODUCTO
  document.getElementById('product-name').addEventListener('input', (e) => {
    updateProductFormIconPreview();
  });
  document.getElementById('product-category').addEventListener('change', (e) => {
    updateProductFormIconPreview();
  });
  document.getElementById('product-icon').addEventListener('change', (e) => {
    updateProductFormIconPreview();
  });
  document.getElementById('product-color').addEventListener('change', (e) => {
    updateProductFormIconPreview();
  });

  // MOTOR DE BÚSQUEDA REACTIVO
  document.getElementById('pos-search-input').addEventListener('input', (e) => {
    renderPOSProducts(e.target.value);
  });
  document.getElementById('inventory-search').addEventListener('input', (e) => {
    renderInventory(e.target.value);
  });
  document.getElementById('clients-search').addEventListener('input', (e) => {
    renderClients(e.target.value);
  });
  document.getElementById('suppliers-search').addEventListener('input', (e) => {
    renderSuppliers(e.target.value);
  });

  // REPORTES EVENTOS
  document.querySelectorAll('.report-filters button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.report-filters button').forEach(b => b.classList.remove('active'));
      button.classList.add('active');
      currentReportRange = button.getAttribute('data-range');
      renderReports();
    });
  });

  const reportMonthPicker = document.getElementById('report-month-picker');
  if (reportMonthPicker) {
    reportMonthPicker.addEventListener('change', (e) => {
      if (e.target.value) {
        document.querySelectorAll('.report-filters button').forEach(b => b.classList.remove('active'));
        currentReportRange = 'mes-especifico';
        renderReports();
      }
    });
  }

  // CENTRO DE NOTIFICACIONES EVENTOS
  const btnNotif = document.getElementById('btn-notifications');
  if (btnNotif) {
    btnNotif.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('notifications-dropdown');
      if (dropdown) {
        dropdown.classList.toggle('active');
      }
    });
  }

  // CERRAR MODALES AL HACER CLICK FUERA O EN BOTONES CLOSE
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        closeModal(overlay.id);
      }
    });
  });

  // Cerrar dropdown de notificaciones al hacer clic en cualquier otra parte
  document.addEventListener('click', () => {
    const dropdown = document.getElementById('notifications-dropdown');
    if (dropdown) {
      dropdown.classList.remove('active');
    }
  });

  // Guardar preferencia de e-boleta al cambiar
  const eboletaCheckbox = document.getElementById('settings-eboleta-active');
  if (eboletaCheckbox) {
    eboletaCheckbox.addEventListener('change', () => {
      saveStateToLocalStorage();
    });
  }

  // Conectar al SII
  const btnConnect = document.getElementById('btn-sii-connect');
  if (btnConnect) {
    btnConnect.addEventListener('click', () => {
      connectSII();
    });
  }

  // Enviar CAPTCHA resuelto
  const btnSubmitCaptcha = document.getElementById('btn-sii-submit-captcha');
  if (btnSubmitCaptcha) {
    btnSubmitCaptcha.addEventListener('click', () => {
      submitSIICaptcha();
    });
  }

  // --- CONTROL DE NAVEGACIÓN Y TICKET MÓVIL ---
  
  // Toggle del menú hamburguesa lateral
  const btnMobileMenu = document.getElementById('btn-mobile-menu');
  const sidebar = document.querySelector('.sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');

  if (btnMobileMenu && sidebar && sidebarBackdrop) {
    btnMobileMenu.addEventListener('click', () => {
      sidebar.classList.toggle('active');
      sidebarBackdrop.classList.toggle('active');
    });

    // Cerrar menú al hacer clic en el fondo oscuro (backdrop)
    sidebarBackdrop.addEventListener('click', () => {
      sidebar.classList.remove('active');
      sidebarBackdrop.classList.remove('active');
    });

    // Cerrar menú móvil al hacer clic en cualquier opción de la barra lateral
    sidebar.querySelectorAll('.menu-item').forEach(item => {
      item.addEventListener('click', () => {
        sidebar.classList.remove('active');
        sidebarBackdrop.classList.remove('active');
      });
    });
  }

  // Deslizar ticket hacia arriba (Ver Ticket en móviles)
  const btnMobileViewTicket = document.getElementById('btn-mobile-view-ticket');
  const ticketSidebar = document.getElementById('pos-ticket-sidebar');
  if (btnMobileViewTicket && ticketSidebar) {
    btnMobileViewTicket.addEventListener('click', () => {
      ticketSidebar.classList.add('active');
    });
  }

  // Deslizar ticket hacia abajo (Cerrar ticket móvil)
  const btnCloseTicketMobile = document.getElementById('btn-close-ticket-mobile');
  if (btnCloseTicketMobile && ticketSidebar) {
    btnCloseTicketMobile.addEventListener('click', () => {
      ticketSidebar.classList.remove('active');
    });
  }
}

function handlePOSClientChange(clientId) {
  const pointsArea = document.getElementById('pos-client-points-area');
  const pointsValue = document.getElementById('pos-client-points-value');
  const checkbox = document.getElementById('pos-use-points-checkbox');

  checkbox.checked = false;

  if (clientId) {
    const client = state.clients.find(c => c.id === clientId);
    if (client) {
      pointsValue.innerText = `${client.points.toLocaleString('es-CL')} pts ($${client.points.toLocaleString('es-CL')})`;
      pointsArea.style.display = 'block';
    } else {
      pointsArea.style.display = 'none';
    }
  } else {
    pointsArea.style.display = 'none';
  }

  renderCart();
}

function updateProductFormIconPreview() {
  const name = document.getElementById('product-name').value.trim();
  const category = document.getElementById('product-category').value;
  const selectedIcon = document.getElementById('product-icon').value;
  const selectedColor = document.getElementById('product-color').value;
  
  const previewBox = document.getElementById('product-preview-icon-box');
  const previewIcon = document.getElementById('product-preview-icon-element');
  
  const autodetected = getProductIconData(name, category);
  const finalIcon = selectedIcon === 'auto' ? autodetected.icon : selectedIcon;
  const finalColor = selectedColor === 'auto' ? autodetected.color : selectedColor;
  
  previewBox.style.backgroundColor = finalColor;
  previewIcon.className = finalIcon;
}

function updateCurrentDateDisplay() {
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const today = new Date();
  document.getElementById('current-date-string').innerText = today.toLocaleDateString('es-CL', options);
}

// --- SISTEMA DE TOASTS ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconClass = 'fa-circle-check';
  if (type === 'warning') iconClass = 'fa-triangle-exclamation';
  if (type === 'danger') iconClass = 'fa-circle-exclamation';
  if (type === 'info') iconClass = 'fa-circle-info';

  toast.innerHTML = `
    <i class="fa-solid ${iconClass} toast-icon"></i>
    <span class="toast-message">${message}</span>
  `;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.transform = 'translateX(120%)';
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// --- CONTROL DE PERMISOS / ROLES ---
function checkPermission() {
  if (activeRole === 'cajero') {
    showToast('Acceso denegado: Se requiere perfil Administrador.', 'danger');
    return false;
  }
  return true;
}

function applyRoleRestrictions() {
  const isCajero = (activeRole === 'cajero');

  const roleSelect = document.getElementById('app-role-select');
  if (roleSelect && roleSelect.value !== activeRole) {
    roleSelect.value = activeRole;
  }

  const newProductBtn = document.getElementById('btn-new-product');
  const newSupplierBtn = document.getElementById('btn-new-supplier');

  if (newProductBtn) {
    if (isCajero) newProductBtn.classList.add('role-restricted');
    else newProductBtn.classList.remove('role-restricted');
  }
  if (newSupplierBtn) {
    if (isCajero) newSupplierBtn.classList.add('role-restricted');
    else newSupplierBtn.classList.remove('role-restricted');
  }

  const inventoryTbody = document.getElementById('inventory-tbody');
  if (inventoryTbody) {
    const actionBtns = inventoryTbody.querySelectorAll('.btn');
    actionBtns.forEach(btn => {
      if (isCajero) btn.classList.add('role-restricted');
      else btn.classList.remove('role-restricted');
    });
  }

  const clientsTbody = document.getElementById('clients-tbody');
  if (clientsTbody) {
    const deleteBtns = clientsTbody.querySelectorAll('.btn-danger');
    deleteBtns.forEach(btn => {
      if (isCajero) btn.classList.add('role-restricted');
      else btn.classList.remove('role-restricted');
    });
  }

  const suppliersTbody = document.getElementById('suppliers-tbody');
  if (suppliersTbody) {
    const actionBtns = suppliersTbody.querySelectorAll('.btn');
    actionBtns.forEach(btn => {
      if (isCajero) btn.classList.add('role-restricted');
      else btn.classList.remove('role-restricted');
    });
  }

  // Restringir visualización del menú de Configuración
  const settingsMenuItem = document.querySelector('.sidebar-menu .menu-item[data-target="settings"]');
  if (settingsMenuItem) {
    if (isCajero) {
      settingsMenuItem.style.display = 'none';
      if (selectedView === 'settings') {
        navigateTo('dashboard');
      }
    } else {
      settingsMenuItem.style.display = 'flex';
    }
  }

  // Restringir visualización de estadísticas y campos exclusivos de Administrador
  document.querySelectorAll('.admin-only-stat').forEach(el => {
    el.style.display = isCajero ? 'none' : '';
  });
}

// --- NAVEGACIÓN SPA ---
function navigateTo(viewId) {
  selectedView = viewId;
  
  document.querySelectorAll('.view-section').forEach(section => {
    section.classList.remove('active');
  });

  document.querySelectorAll('.sidebar-menu .menu-item').forEach(item => {
    item.classList.remove('active');
  });

  const targetSection = document.getElementById(`${viewId}-section`);
  if (targetSection) {
    targetSection.classList.add('active');
  }

  const activeMenuItem = document.querySelector(`.sidebar-menu .menu-item[data-target="${viewId}"]`);
  if (activeMenuItem) {
    activeMenuItem.classList.add('active');
  }

  const titles = {
    dashboard: 'Resumen Diario - Dashboard',
    pos: 'Terminal de Ventas (POS)',
    inventory: 'Control de Inventario',
    clients: 'Directorio de Clientes',
    suppliers: 'Directorio de Proveedores',
    reports: 'Informes Financieros y Gráficos',
    settings: 'Configuración del Sistema'
  };
  document.getElementById('current-view-title').innerText = titles[viewId] || 'Punto 41';

  if (viewId === 'dashboard') {
    renderDashboard();
  } else if (viewId === 'pos') {
    renderPOS();
  } else if (viewId === 'inventory') {
    renderInventory();
  } else if (viewId === 'clients') {
    renderClients();
  } else if (viewId === 'suppliers') {
    renderSuppliers();
  } else if (viewId === 'reports') {
    renderReports();
  } else if (viewId === 'settings') {
    // No special render required for settings as it is static HTML
  }

  checkLowStockAlerts();
  applyRoleRestrictions();
}

window.navigateTo = navigateTo;

function checkLowStockAlerts() {
  updateNotifications();
}

// --- NORMALIZADOR DE BUSCADOR ---
function getNormalizedText(str) {
  if (!str) return '';
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// --- VISTA 1: DASHBOARD LÓGICA ---
function renderDashboard() {
  const todayStr = new Date().toDateString();
  const todaySales = state.sales.filter(s => new Date(s.date).toDateString() === todayStr);

  const totalAmountToday = todaySales.reduce((sum, s) => sum + s.total, 0);
  const totalItemsToday = todaySales.reduce((sum, s) => sum + s.items.reduce((acc, item) => acc + item.quantity, 0), 0);
  const lowStockCount = state.products.filter(p => Number(p.stock) <= Number(p.minStock)).length;
  const clientsCount = state.clients.length;

  const todayProfit = todaySales.reduce((sum, s) => {
    if (s.profit !== undefined) return sum + s.profit;
    const cost = s.items.reduce((acc, item) => {
      const prod = state.products.find(p => p.id === item.productId);
      const c = prod ? Number(prod.costPrice) : 0;
      return acc + (c * item.quantity);
    }, 0);
    return sum + (s.total - cost);
  }, 0);

  document.getElementById('dash-today-sales').innerText = formatCurrency(totalAmountToday);
  document.getElementById('dash-today-profit').innerText = formatCurrency(todayProfit);
  document.getElementById('dash-sales-count').innerText = `${todaySales.length} transacciones`;
  document.getElementById('dash-items-sold').innerText = totalItemsToday;
  document.getElementById('dash-low-stock-count').innerText = lowStockCount;
  document.getElementById('dash-clients-count').innerText = clientsCount;

  // Renderizar 5 últimas ventas
  const recentSalesTbody = document.getElementById('dash-recent-sales-tbody');
  recentSalesTbody.innerHTML = '';
  
  const sortedSales = [...state.sales].sort((a, b) => new Date(b.date) - new Date(a.date));
  const top5Sales = sortedSales.slice(0, 5);

  if (top5Sales.length === 0) {
    recentSalesTbody.innerHTML = `<tr><td colspan="5" class="text-center" style="padding: 30px; text-align: center; color: var(--text-muted);">No hay ventas registradas hoy.</td></tr>`;
  } else {
    top5Sales.forEach(sale => {
      const clientObj = state.clients.find(c => c.id === sale.clientId);
      const clientName = clientObj ? clientObj.name : 'Cliente Anónimo';
      const saleTime = new Date(sale.date).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      
      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.title = 'Haga clic para ver el desglose de la venta';
      tr.innerHTML = `
        <td><strong>${sale.id}</strong></td>
        <td>${saleTime}</td>
        <td>${clientName}</td>
        <td><strong>${formatCurrency(sale.total)}</strong></td>
        <td><span class="badge badge-neutral">${capitalize(sale.paymentMethod)}</span></td>
      `;
      tr.addEventListener('click', () => {
        viewSaleDetails(sale.id);
      });
      recentSalesTbody.appendChild(tr);
    });
  }

  // Renderizar alertas de stock
  const stockAlertsContainer = document.getElementById('dash-stock-alerts-container');
  stockAlertsContainer.innerHTML = '';
  const lowStockProducts = state.products.filter(p => Number(p.stock) <= Number(p.minStock));

  if (lowStockProducts.length === 0) {
    stockAlertsContainer.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--success); font-weight: 500;">
        <i class="fa-solid fa-circle-check" style="font-size: 24px; margin-bottom: 8px; display: block;"></i>
        Todo el inventario está en niveles óptimos
      </div>
    `;
  } else {
    lowStockProducts.slice(0, 5).forEach(prod => {
      const prov = state.suppliers.find(s => s.id === prod.supplierId);
      const provName = prov ? prov.name : 'Sin Proveedor';

      const alertDiv = document.createElement('div');
      alertDiv.className = 'stock-alert-item';
      alertDiv.innerHTML = `
        <div class="stock-alert-info">
          <h4>${prod.name}</h4>
          <span>Prov: ${provName}</span>
        </div>
        <div style="text-align: right;">
          <span class="stock-alert-badge">${prod.stock} / ${prod.minStock}</span>
          <span style="display: block; font-size: 9px; color: var(--text-muted); margin-top: 2px;">Min stock</span>
        </div>
      `;
      stockAlertsContainer.appendChild(alertDiv);
    });
  }
}

// --- VISTA 2: POS LÓGICA ---
let activeCategoryFilter = 'Todos';

function renderPOS() {
  const categoriesContainer = document.getElementById('pos-categories-container');
  categoriesContainer.innerHTML = '';
  
  const categories = ['Todos', ...new Set(state.products.map(p => p.category))];
  
  categories.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = `category-tab ${activeCategoryFilter === cat ? 'active' : ''}`;
    btn.innerText = cat;
    btn.addEventListener('click', () => {
      activeCategoryFilter = cat;
      renderPOS();
    });
    categoriesContainer.appendChild(btn);
  });

  const clientSelect = document.getElementById('pos-client-select');
  const currentSelectedValue = clientSelect.value;
  clientSelect.innerHTML = '<option value="">-- Cliente Anónimo --</option>';
  
  state.clients.forEach(cli => {
    const opt = document.createElement('option');
    opt.value = cli.id;
    opt.innerText = `${cli.name} (${cli.rut})`;
    if (cli.id === currentSelectedValue) opt.selected = true;
    clientSelect.appendChild(opt);
  });

  // Ocultar o refrescar el panel de puntos según el cliente seleccionado
  handlePOSClientChange(currentSelectedValue);
  syncPOSClientSearch();

  renderPOSProducts();
  renderCart();
}

function renderPOSProducts(searchQuery = '') {
  const productsGrid = document.getElementById('pos-products-grid');
  productsGrid.innerHTML = '';

  const normalizedQuery = getNormalizedText(searchQuery);

  const filteredProducts = state.products.filter(prod => {
    // Ocultar del POS si no está marcado para la venta
    if (prod.posVisible === false) {
      return false;
    }
    if (activeCategoryFilter !== 'Todos' && prod.category !== activeCategoryFilter) {
      return false;
    }
    if (normalizedQuery) {
      const matchName = getNormalizedText(prod.name).includes(normalizedQuery);
      const matchSKU = getNormalizedText(prod.sku).includes(normalizedQuery);
      const matchCategory = getNormalizedText(prod.category).includes(normalizedQuery);
      return matchName || matchSKU || matchCategory;
    }
    return true;
  });

  if (filteredProducts.length === 0) {
    productsGrid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
        <i class="fa-solid fa-circle-question" style="font-size: 32px; margin-bottom: 12px; display: block; color: var(--text-light)"></i>
        No se encontraron productos coincidentes
      </div>
    `;
    return;
  }

  filteredProducts.forEach(prod => {
    const availableStock = getProductAvailableStock(prod);
    const isOutOfStock = Number(availableStock) <= 0;
    const isLowStock = Number(availableStock) <= Number(prod.minStock) && !isOutOfStock;
    
    const card = document.createElement('div');
    card.className = `product-card ${isOutOfStock ? 'out-of-stock' : ''}`;
    
    let badgeHTML = '';
    if (isOutOfStock) {
      badgeHTML = `<span class="badge badge-danger product-card-badge">Sin Stock</span>`;
    } else if (isLowStock) {
      badgeHTML = `<span class="badge badge-warning product-card-badge">Poco Stock</span>`;
    }

    card.innerHTML = `
      ${badgeHTML}
      <div class="product-card-icon-wrapper" style="background-color: ${prod.color || '#2563eb'}">
        <i class="${prod.icon || 'fa-solid fa-mug-hot'}"></i>
      </div>
      <span class="product-card-category">${prod.category}</span>
      <h4 class="product-card-title">${prod.name}</h4>
      <div class="product-card-footer">
        <span class="product-card-price">${formatCurrency(prod.salePrice)}</span>
        <span class="product-card-stock">Stock: <strong>${availableStock}</strong></span>
      </div>
    `;

    if (!isOutOfStock) {
      card.addEventListener('click', () => {
        addToCart(prod.id);
      });
    }

    productsGrid.appendChild(card);
  });
}

// --- OPERACIONES DE CARRITO ---
function addToCart(productId) {
  const prod = state.products.find(p => p.id === productId);
  if (!prod) return;

  const availableStock = getProductAvailableStock(prod);
  const existingItemIndex = cart.findIndex(item => item.productId === productId);
  const currentQuantityInCart = existingItemIndex > -1 ? cart[existingItemIndex].quantity : 0;

  if (currentQuantityInCart + 1 > availableStock) {
    showToast(`Stock insuficiente para agregar más de: ${prod.name}`, 'warning');
    return;
  }

  if (existingItemIndex > -1) {
    cart[existingItemIndex].quantity += 1;
  } else {
    cart.push({
      productId: prod.id,
      name: prod.name,
      price: prod.salePrice,
      quantity: 1,
      discount: 0,
      discountType: 'percent'
    });
  }

  showToast(`${prod.name} agregado al ticket`, 'success');
  renderCart();
}

function updateCartQty(index, newQty) {
  const item = cart[index];
  const prod = state.products.find(p => p.id === item.productId);
  const availableStock = getProductAvailableStock(prod);
  
  if (newQty <= 0) {
    cart.splice(index, 1);
    showToast('Producto eliminado del ticket', 'info');
  } else if (newQty > availableStock) {
    showToast(`Stock insuficiente. Solo quedan ${availableStock} unidades.`, 'warning');
    item.quantity = availableStock;
  } else {
    item.quantity = newQty;
  }
  
  renderCart();
}

function removeCartItem(index) {
  cart.splice(index, 1);
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cart-items-container');
  container.innerHTML = '';

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="empty-cart-state">
        <i class="fa-solid fa-cart-shopping"></i>
        <p>El carrito está vacío</p>
        <span>Selecciona productos de la izquierda para comenzar</span>
      </div>
    `;
    document.getElementById('ticket-subtotal').innerText = '$0';
    document.getElementById('ticket-discount-row').style.display = 'none';
    document.getElementById('ticket-points-discount-row').style.display = 'none';
    document.getElementById('ticket-total').innerText = '$0';
    document.getElementById('btn-checkout-total').innerText = '$0';
    
    // Actualizar barra del carrito móvil
    const mobileCountEl = document.getElementById('pos-mobile-cart-count');
    const mobileTotalEl = document.getElementById('pos-mobile-cart-total');
    if (mobileCountEl && mobileTotalEl) {
      mobileCountEl.innerText = '0 productos';
      mobileTotalEl.innerText = '$0';
    }
    return;
  }

  let subtotal = 0;
  let totalDiscounts = 0;

  cart.forEach((item, index) => {
    let itemDiscountAmount = 0;
    if (item.discount > 0) {
      if (item.discountType === 'percent') {
        itemDiscountAmount = Math.round(item.price * (item.discount / 100));
      } else {
        itemDiscountAmount = item.discount;
      }
    }

    const finalPrice = item.price - itemDiscountAmount;
    const finalItemTotal = finalPrice * item.quantity;
    
    subtotal += item.price * item.quantity;
    totalDiscounts += itemDiscountAmount * item.quantity;

    const row = document.createElement('div');
    row.className = 'cart-item';
    
    let discountBadge = '';
    if (item.discount > 0) {
      const descLabel = item.discountType === 'percent' ? `-${item.discount}%` : `-$${item.discount}`;
      discountBadge = `
        <span class="cart-item-discount-pill">
          ${descLabel}
          <button onclick="removeProductDiscount(${index})" title="Quitar descuento">
            <i class="fa-solid fa-circle-xmark"></i>
          </button>
        </span>
      `;
    }

    row.innerHTML = `
      <div class="cart-item-details">
        <div class="cart-item-title">${item.name}</div>
        ${discountBadge}
        <div>
          <button class="cart-item-discount-action" onclick="openDiscountModal('product', ${index})">
            <i class="fa-solid fa-tag"></i> Desct.
          </button>
        </div>
      </div>
      <div class="cart-item-controls">
        <div class="cart-item-qty">
          <button onclick="updateCartQty(${index}, ${item.quantity - 1})">-</button>
          <span>${item.quantity}</span>
          <button onclick="updateCartQty(${index}, ${item.quantity + 1})">+</button>
        </div>
      </div>
      <div class="cart-item-price-block">
        <span class="cart-item-total">${formatCurrency(finalItemTotal)}</span>
        ${item.discount > 0 ? `<span class="cart-item-original-price">${formatCurrency(item.price * item.quantity)}</span>` : ''}
      </div>
    `;
    container.appendChild(row);
  });

  const itemsTotalSum = subtotal - totalDiscounts;
  let finalCartDiscountAmount = 0;
  
  if (cartDiscount.value > 0) {
    if (cartDiscount.type === 'percent') {
      finalCartDiscountAmount = Math.round(itemsTotalSum * (cartDiscount.value / 100));
    } else {
      finalCartDiscountAmount = cartDiscount.value;
    }
    totalDiscounts += finalCartDiscountAmount;
  }

  // --- LOGICA DE REDENCIÓN DE PUNTOS ---
  let pointsDiscount = 0;
  const clientId = document.getElementById('pos-client-select').value;
  const usePointsCheckbox = document.getElementById('pos-use-points-checkbox');

  if (clientId && usePointsCheckbox && usePointsCheckbox.checked) {
    const client = state.clients.find(c => c.id === clientId);
    if (client && client.points > 0) {
      const currentTotalBeforePoints = Math.max(0, subtotal - totalDiscounts);
      pointsDiscount = Math.min(currentTotalBeforePoints, client.points);
      totalDiscounts += pointsDiscount;
    }
  }

  const pointsDiscountRow = document.getElementById('ticket-points-discount-row');
  if (pointsDiscount > 0) {
    pointsDiscountRow.style.display = 'flex';
    document.getElementById('ticket-points-discount-amount').innerText = `-${formatCurrency(pointsDiscount)}`;
  } else {
    pointsDiscountRow.style.display = 'none';
  }

  const finalTotal = Math.max(0, subtotal - totalDiscounts);

  document.getElementById('ticket-subtotal').innerText = formatCurrency(subtotal);

  const discountRow = document.getElementById('ticket-discount-row');
  if (totalDiscounts - pointsDiscount > 0) {
    discountRow.style.display = 'flex';
    let discountDesc = '';
    if (cartDiscount.value > 0) {
      discountDesc = cartDiscount.type === 'percent' ? `Cart: -${cartDiscount.value}%` : `Cart: -$${cartDiscount.value}`;
    } else {
      discountDesc = 'Items';
    }
    document.getElementById('ticket-discount-desc').innerText = discountDesc;
    document.getElementById('ticket-discount-amount').innerText = `-${formatCurrency(totalDiscounts - pointsDiscount)}`;
  } else {
    discountRow.style.display = 'none';
  }

  document.getElementById('ticket-total').innerText = formatCurrency(finalTotal);
  document.getElementById('btn-checkout-total').innerText = formatCurrency(finalTotal);
  updateCashChange();

  // Actualizar barra del carrito móvil
  const mobileCountEl = document.getElementById('pos-mobile-cart-count');
  const mobileTotalEl = document.getElementById('pos-mobile-cart-total');
  if (mobileCountEl && mobileTotalEl) {
    const totalQty = cart.reduce((sum, item) => sum + item.quantity, 0);
    mobileCountEl.innerText = `${totalQty} producto${totalQty !== 1 ? 's' : ''}`;
    mobileTotalEl.innerText = formatCurrency(finalTotal);
  }
}

function clearCart() {
  cart = [];
  cartDiscount = { value: 0, type: 'percent' };
  renderCart();
  showToast('Ticket vaciado', 'info');
}

function removeCartDiscount() {
  cartDiscount = { value: 0, type: 'percent' };
  renderCart();
  showToast('Descuento al total eliminado', 'info');
}

function removeProductDiscount(index) {
  cart[index].discount = 0;
  renderCart();
  showToast('Descuento de producto eliminado', 'info');
}

// --- DIALOGO DE DESCUENTOS (MODAL) ---
function openDiscountModal(targetType, targetId) {
  const modal = document.getElementById('discount-modal');
  document.getElementById('discount-target-type').value = targetType;
  document.getElementById('discount-target-id').value = targetId;

  const descLabel = document.getElementById('discount-target-desc');
  if (targetType === 'cart') {
    descLabel.innerText = 'Aplicando descuento al valor total del ticket.';
  } else {
    const item = cart[targetId];
    descLabel.innerText = `Aplicando descuento al producto: ${item.name} (${formatCurrency(item.price)} c/u)`;
  }

  document.getElementById('discount-value').value = 0;
  modal.classList.add('active');
}

function handleDiscountFormSubmit(e) {
  e.preventDefault();
  const targetType = document.getElementById('discount-target-type').value;
  const targetId = document.getElementById('discount-target-id').value;
  
  const val = Number(document.getElementById('discount-value').value);

  if (val < 0 || val > 100) {
    showToast('El porcentaje de descuento debe estar entre 0% y 100%', 'danger');
    return;
  }

  if (targetType === 'cart') {
    cartDiscount.value = val;
    cartDiscount.type = 'percent';
    showToast('Descuento aplicado al total del ticket', 'success');
  } else {
    const idx = Number(targetId);
    cart[idx].discount = val;
    cart[idx].discountType = 'percent';
    showToast('Descuento aplicado al producto', 'success');
  }

  closeModal('discount-modal');
  renderCart();
}

// --- CONFIRMAR VENTA (CHECKOUT) ---
function executeCheckout() {
  if (cart.length === 0) {
    showToast('No hay productos en el carrito para realizar una venta.', 'warning');
    return;
  }

  const clientId = document.getElementById('pos-client-select').value;
  const paymentMethod = document.querySelector('input[name="payment-method"]:checked').value;
  const usePointsCheckbox = document.getElementById('pos-use-points-checkbox');

  let subtotal = 0;
  let totalDiscounts = 0;

  cart.forEach(item => {
    let itemDiscount = 0;
    if (item.discount > 0) {
      if (item.discountType === 'percent') {
        itemDiscount = Math.round(item.price * (item.discount / 100));
      } else {
        itemDiscount = item.discount;
      }
    }
    subtotal += item.price * item.quantity;
    totalDiscounts += itemDiscount * item.quantity;
  });

  const itemsTotal = subtotal - totalDiscounts;
  let cartDiscountAmount = 0;
  if (cartDiscount.value > 0) {
    if (cartDiscount.type === 'percent') {
      cartDiscountAmount = Math.round(itemsTotal * (cartDiscount.value / 100));
    } else {
      cartDiscountAmount = cartDiscount.value;
    }
    totalDiscounts += cartDiscountAmount;
  }

  // --- VALIDAR CANJE DE PUNTOS ---
  let pointsRedeemed = 0;
  let client = null;
  
  if (clientId) {
    client = state.clients.find(c => c.id === clientId);
    if (client && usePointsCheckbox && usePointsCheckbox.checked && client.points > 0) {
      const currentTotalBeforePoints = Math.max(0, subtotal - totalDiscounts);
      pointsRedeemed = Math.min(currentTotalBeforePoints, client.points);
      totalDiscounts += pointsRedeemed;
      
      // Deducir puntos de la cuenta del cliente
      client.points -= pointsRedeemed;
    }
  }

  const finalTotal = Math.max(0, subtotal - totalDiscounts);

  // Validar y descontar del inventario
  for (let item of cart) {
    const prod = state.products.find(p => p.id === item.productId);
    if (!prod) continue;
    
    const availableStock = getProductAvailableStock(prod);
    if (availableStock < item.quantity) {
      showToast(`Error crítico: Stock insuficiente en el transcurso de la venta para: ${prod.name}`, 'danger');
      return;
    }
    
    // Si el producto tiene receta, descontamos de los insumos
    if (prod.recipe && prod.recipe.length > 0) {
      prod.recipe.forEach(recipeItem => {
        const ingredient = state.products.find(p => p.id === recipeItem.id);
        if (ingredient) {
          ingredient.stock = Math.max(0, Number(ingredient.stock) - (item.quantity * Number(recipeItem.qty)));
        }
      });
    } else {
      // Si no tiene receta, descontamos del stock directo
      prod.stock = Math.max(0, Number(prod.stock) - item.quantity);
    }
  }

  // --- ACUMULAR PUNTOS NUEVOS (10% de cashback: 100 pesos en puntos por cada 1000 pesos pagados en efectivo/tarjeta) ---
  // Los puntos nuevos se acumulan sobre el saldo neto real pagado
  const pointsEarned = Math.floor(finalTotal / 1000) * 100;
  if (client) {
    client.points += pointsEarned;
  }

  const saleItems = cart.map(item => {
    const prod = state.products.find(p => p.id === item.productId);
    const cost = prod ? Number(prod.costPrice) : 0;
    return {
      productId: item.productId,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      cost: cost,
      discount: item.discount,
      discountType: item.discountType,
      total: Math.max(0, (item.price - (item.discountType === 'percent' ? Math.round(item.price * (item.discount / 100)) : item.discount)) * item.quantity)
    };
  });

  const totalCost = saleItems.reduce((sum, item) => sum + (item.cost * item.quantity), 0);
  const profit = Math.round(finalTotal) - totalCost;

  const newSale = {
    id: 'V-' + (state.sales.length + 1001),
    date: new Date().toISOString(),
    clientId: clientId || null,
    items: saleItems,
    discountTotal: cartDiscount.value,
    discountType: cartDiscount.type,
    subtotal: subtotal,
    total: Math.round(finalTotal),
    neto: Math.round(Math.round(finalTotal) / 1.19),
    iva: Math.round(finalTotal) - Math.round(Math.round(finalTotal) / 1.19),
    cost: totalCost,
    profit: profit,
    paymentMethod: paymentMethod,
    pointsRedeemed: pointsRedeemed,
    pointsEarned: pointsEarned,
    clientPointsBalance: client ? client.points : 0
  };

  state.sales.push(newSale);
  saveStateToLocalStorage();

  // Integración e-boleta SII en la Nube (Solo Efectivo o Transferencia con confirmación)
  const eboletaActive = document.getElementById('settings-eboleta-active')?.checked;
  if (eboletaActive && (paymentMethod === 'efectivo' || paymentMethod === 'transferencia')) {
    const wantsBoleta = confirm(`¿Desea emitir boleta electrónica en el SII para esta venta de $${Math.round(finalTotal).toLocaleString('es-CL')} pagada con ${paymentMethod === 'efectivo' ? 'Efectivo' : 'Transferencia'}?`);
    
    if (wantsBoleta) {
      showToast('Enviando boleta al SII en la nube...', 'info');
      fetch('/api/sii/emitir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ total: Math.round(finalTotal) })
      })
      .then(res => {
        if (!res.ok) {
          return res.text().then(text => { throw new Error(text || `Error HTTP ${res.status}`); });
        }
        return res.json();
      })
      .then(data => {
        if (data.success) {
          showToast('Boleta emitida con éxito en el SII', 'success');
        } else {
          showToast('Error SII: ' + data.message, 'danger');
        }
      })
      .catch(err => {
        showToast('Error de red al conectar con el facturador SII', 'danger');
      });
    }
  }

  cart = [];
  cartDiscount = { value: 0, type: 'percent' };
  
  const cashInput = document.getElementById('pos-cash-received');
  if (cashInput) cashInput.value = '';
  
  document.getElementById('pos-client-select').value = '';
  document.getElementById('pos-search-input').value = '';

  let pointsMsg = '';
  if (client) {
    pointsMsg = ` | Ganó +$${pointsEarned.toLocaleString('es-CL')} en puntos (Nuevo saldo: $${client.points.toLocaleString('es-CL')})`;
  }

  showToast(`Venta ${newSale.id} confirmada por ${formatCurrency(newSale.total)}${pointsMsg}. Enviando comprobante a impresión...`, 'success');
  
  // Cerrar el ticket móvil deslizable si está abierto
  const ticketSidebar = document.getElementById('pos-ticket-sidebar');
  if (ticketSidebar) ticketSidebar.classList.remove('active');

  renderPOS();
  checkLowStockAlerts();

  printReceipt(newSale);
}

// --- IMPRESIÓN DE COMPROBANTE ---
function printReceipt(sale) {
  document.getElementById('pr-sale-id').innerText = `BOLETA N°: ${sale.id}`;
  
  const sDateObj = new Date(sale.date);
  document.getElementById('pr-date').innerText = `FECHA: ${sDateObj.toLocaleDateString('es-CL')} ${sDateObj.toLocaleTimeString('es-CL')}`;
  
  const clientObj = state.clients.find(c => c.id === sale.clientId);
  document.getElementById('pr-client').innerText = clientObj ? `${clientObj.name} (${clientObj.rut})` : 'Cliente Anónimo';
  
  document.getElementById('pr-method').innerText = capitalize(sale.paymentMethod);

  const tbody = document.getElementById('pr-items-tbody');
  tbody.innerHTML = '';
  
  sale.items.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td align="left">
        ${item.name}<br>
        <span style="font-size: 8px;">${item.quantity} x ${formatCurrency(item.price)}</span>
      </td>
      <td align="center" style="vertical-align: middle;">${item.quantity}</td>
      <td align="right" style="vertical-align: middle;">${formatCurrency(item.total)}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('pr-subtotal').innerText = formatCurrency(sale.subtotal);
  
  const discountAmount = sale.subtotal - sale.total - (sale.pointsRedeemed || 0);
  const elDisc = document.getElementById('pr-discount-row-print');
  if (elDisc) {
    if (discountAmount > 0) {
      elDisc.style.display = 'flex';
      elDisc.querySelector('#pr-discount').innerText = `-${formatCurrency(discountAmount)}`;
    } else {
      elDisc.style.display = 'none';
    }
  }

  document.getElementById('pr-total').innerText = formatCurrency(sale.total);

  const neto = sale.neto || Math.round(sale.total / 1.19);
  const iva = sale.iva || (sale.total - neto);
  document.getElementById('pr-tax-net').innerText = formatCurrency(neto);
  document.getElementById('pr-tax-value').innerText = formatCurrency(iva);

  // --- IMPRIMIR DETALLES DE PUNTOS EN LA BOLETA ---
  const prPointsRow = document.getElementById('pr-points-row-print');
  if (sale.clientId && prPointsRow) {
    prPointsRow.style.display = 'block';
    
    const prRedeemedRow = document.getElementById('pr-points-redeemed-row');
    const prRedeemedVal = document.getElementById('pr-points-redeemed');
    if (sale.pointsRedeemed > 0) {
      prRedeemedRow.style.display = 'flex';
      prRedeemedVal.innerText = `-${formatCurrency(sale.pointsRedeemed)}`;
    } else {
      prRedeemedRow.style.display = 'none';
    }
    
    document.getElementById('pr-points-earned').innerText = `+$${sale.pointsEarned.toLocaleString('es-CL')}`;
    document.getElementById('pr-points-balance').innerText = `$${sale.clientPointsBalance.toLocaleString('es-CL')} pts`;
  } else if (prPointsRow) {
    prPointsRow.style.display = 'none';
  }

  document.body.classList.add('printing-receipt');
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-receipt');
    }, 500);
  }, 250);
}

// --- DESGLOSE DE VENTA DETALLADO ---
function viewSaleDetails(saleId) {
  const sale = state.sales.find(s => s.id === saleId);
  if (!sale) return;

  document.getElementById('det-sale-id').innerText = sale.id;
  
  const sDateObj = new Date(sale.date);
  document.getElementById('det-sale-date').innerText = `${sDateObj.toLocaleDateString('es-CL')} ${sDateObj.toLocaleTimeString('es-CL')}`;
  
  const clientObj = state.clients.find(c => c.id === sale.clientId);
  document.getElementById('det-sale-client').innerText = clientObj ? `${clientObj.name} (${clientObj.rut})` : 'Cliente Anónimo';
  
  document.getElementById('det-sale-method').innerText = capitalize(sale.paymentMethod);

  const tbody = document.getElementById('det-sale-items-tbody');
  tbody.innerHTML = '';
  
  sale.items.forEach(item => {
    const itemDiscVal = item.discount > 0 ? (item.discountType === 'percent' ? Math.round(item.price * (item.discount / 100)) : item.discount) : 0;
    
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.name}</td>
      <td style="text-align: center;">${item.quantity}</td>
      <td style="text-align: right;">${formatCurrency(item.price)}</td>
      <td style="text-align: right; color: var(--warning);">${itemDiscVal > 0 ? `-${formatCurrency(itemDiscVal)}` : '-'}</td>
      <td style="text-align: right;"><strong>${formatCurrency(item.total)}</strong></td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('det-sale-subtotal').innerText = formatCurrency(sale.subtotal);
  
  const discountTotalApplied = sale.subtotal - sale.total - (sale.pointsRedeemed || 0);
  const discRow = document.getElementById('det-sale-discount-row');
  if (discountTotalApplied > 0) {
    discRow.style.display = 'flex';
    document.getElementById('det-sale-discount').innerText = `-${formatCurrency(discountTotalApplied)}`;
  } else {
    discRow.style.display = 'none';
  }

  // --- DESGLOSE DE PUNTOS EN DETALLE ---
  const detPointsRow = document.getElementById('det-sale-points-row');
  const detPointsEarnedRow = document.getElementById('det-sale-points-earned-row');
  
  if (sale.clientId) {
    if (sale.pointsRedeemed > 0) {
      detPointsRow.style.display = 'flex';
      document.getElementById('det-sale-points-redeemed').innerText = `-$${sale.pointsRedeemed.toLocaleString('es-CL')} pts`;
    } else {
      detPointsRow.style.display = 'none';
    }
    
    detPointsEarnedRow.style.display = 'flex';
    document.getElementById('det-sale-points-earned').innerText = `+$${sale.pointsEarned.toLocaleString('es-CL')} pts (Saldo final: $${sale.clientPointsBalance.toLocaleString('es-CL')})`;
  } else {
    detPointsRow.style.display = 'none';
    detPointsEarnedRow.style.display = 'none';
  }
  
  document.getElementById('det-sale-total').innerText = formatCurrency(sale.total);

  const neto = sale.neto || Math.round(sale.total / 1.19);
  const iva = sale.iva || (sale.total - neto);
  document.getElementById('det-sale-tax-net').innerText = formatCurrency(neto);
  document.getElementById('det-sale-tax-value').innerText = formatCurrency(iva);

  const saleCost = sale.cost !== undefined ? sale.cost : sale.items.reduce((sum, item) => {
    const prod = state.products.find(p => p.id === item.productId);
    const c = prod ? Number(prod.costPrice) : 0;
    return sum + (c * item.quantity);
  }, 0);
  const saleProfit = sale.profit !== undefined ? sale.profit : (sale.total - saleCost);
  document.getElementById('det-sale-profit').innerText = formatCurrency(saleProfit);

  const reprintBtn = document.getElementById('btn-reprint-receipt');
  const newReprintBtn = reprintBtn.cloneNode(true);
  reprintBtn.parentNode.replaceChild(newReprintBtn, reprintBtn);
  newReprintBtn.addEventListener('click', () => {
    printReceipt(sale);
  });

  document.getElementById('sale-detail-modal').classList.add('active');
}

// --- VISTA 3: INVENTARIO LÓGICA ---
function renderInventory(searchQuery = '') {
  const tbody = document.getElementById('inventory-tbody');
  tbody.innerHTML = '';

  const supplierSelect = document.getElementById('product-supplier');
  supplierSelect.innerHTML = '<option value="">-- Seleccionar Proveedor --</option>';
  state.suppliers.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.innerText = s.name;
    supplierSelect.appendChild(opt);
  });

  const query = getNormalizedText(searchQuery);

  const filtered = state.products.filter(p => {
    if (!query) return true;
    
    const prov = state.suppliers.find(s => s.id === p.supplierId);
    const provName = prov ? prov.name : '';

    return getNormalizedText(p.name).includes(query) ||
           getNormalizedText(p.sku).includes(query) ||
           getNormalizedText(p.category).includes(query) ||
           getNormalizedText(provName).includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">No se encontraron productos en el inventario.</td></tr>`;
    return;
  }

  filtered.forEach(p => {
    const prov = state.suppliers.find(s => s.id === p.supplierId);
    const provName = prov ? prov.name : '<span class="text-danger">No asignado</span>';
    
    const availableStock = getProductAvailableStock(p);
    const isLow = Number(availableStock) <= Number(p.minStock);
    const hasRecipe = p.recipe && p.recipe.length > 0;

    const iconClass = p.icon || 'fa-solid fa-mug-hot';
    const iconColor = p.color || '#2563eb';

    const tr = document.createElement('tr');
    
    let nameDisplay = p.name;
    if (p.posVisible === false) {
      nameDisplay = `${p.name} <span style="font-size: 10px; color: var(--text-muted); font-style: italic;">(Insumo)</span>`;
    }

    let stockDisplay = `${availableStock} (min: ${p.minStock})`;
    if (hasRecipe) {
      stockDisplay = `${availableStock} <span class="badge-stock-calculated">Receta</span> (min: ${p.minStock})`;
    }

    tr.innerHTML = `
      <td><strong>${p.sku}</strong></td>
      <td>
        <div class="inventory-icon-thumbnail" style="background-color: ${iconColor};" title="${p.name}">
          <i class="${iconClass}"></i>
        </div>
      </td>
      <td>${nameDisplay}</td>
      <td><span class="badge badge-neutral">${p.category}</span></td>
      <td>${formatCurrency(p.costPrice)}</td>
      <td><strong>${formatCurrency(p.salePrice)}</strong></td>
      <td>
        <span class="badge ${isLow ? 'badge-danger' : 'badge-success'}">
          ${stockDisplay}
        </span>
      </td>
      <td>${provName}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editProduct('${p.id}')" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deleteProduct('${p.id}')" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  applyRoleRestrictions();
}

function openProductModal(prodId = null) {
  if (!checkPermission()) return;

  const modal = document.getElementById('product-modal');
  const title = document.getElementById('product-modal-title');
  const form = document.getElementById('product-form');
  form.reset();

  const previewBox = document.getElementById('product-preview-icon-box');
  const previewIcon = document.getElementById('product-preview-icon-element');
  const recipeContainer = document.getElementById('recipe-ingredients-list');
  recipeContainer.innerHTML = ''; // Limpiar ingredientes anteriores

  if (prodId) {
    const prod = state.products.find(p => p.id === prodId);
    if (!prod) return;

    title.innerText = 'Editar Producto';
    document.getElementById('product-id').value = prod.id;
    document.getElementById('product-name').value = prod.name;
    document.getElementById('product-sku').value = prod.sku;
    document.getElementById('product-category').value = prod.category;
    document.getElementById('product-stock').value = prod.stock;
    document.getElementById('product-min-stock').value = prod.minStock;
    document.getElementById('product-cost-price').value = prod.costPrice;
    document.getElementById('product-sale-price').value = prod.salePrice;
    document.getElementById('product-supplier').value = prod.supplierId;
    
    const isPOSVisible = prod.posVisible !== false;
    document.getElementById('product-pos-visible').checked = isPOSVisible;
    document.getElementById('product-recipe-section').style.display = isPOSVisible ? 'block' : 'none';

    // Cargar ingredientes si existen
    if (prod.recipe && prod.recipe.length > 0) {
      prod.recipe.forEach(item => {
        addRecipeIngredientRow(item.id, item.qty, prod.id);
      });
    }

    // Determinar si el icono/color guardados eran personalizados o autodetectados
    const autodetected = getProductIconData(prod.name, prod.category);
    const isCustomIcon = prod.icon !== autodetected.icon;
    const isCustomColor = prod.color !== autodetected.color;

    document.getElementById('product-icon').value = isCustomIcon ? prod.icon : 'auto';
    document.getElementById('product-color').value = isCustomColor ? prod.color : 'auto';

    // Cargar previsualización
    previewBox.style.backgroundColor = prod.color || autodetected.color;
    previewIcon.className = prod.icon || autodetected.icon;
  } else {
    title.innerText = 'Nuevo Producto';
    document.getElementById('product-id').value = '';
    document.getElementById('product-sku').value = 'P41-' + Math.floor(1000 + Math.random() * 9000);
    document.getElementById('product-pos-visible').checked = true;
    document.getElementById('product-recipe-section').style.display = 'block';

    document.getElementById('product-icon').value = 'auto';
    document.getElementById('product-color').value = 'auto';

    // Resetear a valores por defecto
    previewBox.style.backgroundColor = '#2563eb';
    previewIcon.className = 'fa-solid fa-mug-hot';
  }

  modal.classList.add('active');
}

window.editProduct = openProductModal;

// Agregar una fila para ingrediente/insumo en la receta
function addRecipeIngredientRow(selectedId = '', quantity = '', excludeId = '') {
  const container = document.getElementById('recipe-ingredients-list');
  
  // Filtrar productos que son insumos o materias primas
  // Excluimos el producto actual para evitar auto-referencias circulares
  const ingredientsList = state.products.filter(p => p.id !== excludeId);
  
  if (ingredientsList.length === 0) {
    showToast('Debes crear insumos primero en el inventario para poder agregarlos a una receta', 'warning');
    return;
  }

  const row = document.createElement('div');
  row.className = 'recipe-ingredient-row';
  row.innerHTML = `
    <select class="recipe-ing-select" required>
      <option value="">-- Seleccionar insumo --</option>
      ${ingredientsList.map(p => {
        const isSelected = p.id === selectedId;
        const tag = p.posVisible === false ? ' [Insumo]' : '';
        return `<option value="${p.id}" ${isSelected ? 'selected' : ''}>${p.name} (${p.sku})${tag}</option>`;
      }).join('')}
    </select>
    <input type="number" class="recipe-ing-qty" min="0.001" step="any" required placeholder="Cantidad" value="${quantity}">
    <button type="button" class="btn-remove-ingredient" onclick="this.parentElement.remove()" title="Eliminar ingrediente">
      <i class="fa-solid fa-trash-can"></i>
    </button>
  `;
  container.appendChild(row);
}
window.addRecipeIngredientRow = addRecipeIngredientRow;

// Toggles y botones del modal de productos
document.getElementById('product-pos-visible')?.addEventListener('change', (e) => {
  document.getElementById('product-recipe-section').style.display = e.target.checked ? 'block' : 'none';
});

document.getElementById('btn-add-recipe-ingredient')?.addEventListener('click', () => {
  const currentId = document.getElementById('product-id').value;
  addRecipeIngredientRow('', '', currentId);
});

function handleProductFormSubmit(e) {
  e.preventDefault();
  if (!checkPermission()) return;

  const id = document.getElementById('product-id').value;
  const name = document.getElementById('product-name').value;
  const sku = document.getElementById('product-sku').value;
  const category = document.getElementById('product-category').value;
  const stock = Number(document.getElementById('product-stock').value);
  const minStock = Number(document.getElementById('product-min-stock').value);
  const costPrice = Number(document.getElementById('product-cost-price').value);
  const salePrice = Number(document.getElementById('product-sale-price').value);
  const supplierId = document.getElementById('product-supplier').value;
  const posVisible = document.getElementById('product-pos-visible').checked;

  // Recopilar ingredientes de receta
  const recipe = [];
  if (posVisible) {
    const rows = document.querySelectorAll('.recipe-ingredient-row');
    rows.forEach(row => {
      const ingId = row.querySelector('.recipe-ing-select').value;
      const ingQty = Number(row.querySelector('.recipe-ing-qty').value);
      if (ingId && ingQty > 0) {
        recipe.push({ id: ingId, qty: ingQty });
      }
    });
  }

  const selectedIcon = document.getElementById('product-icon').value;
  const selectedColor = document.getElementById('product-color').value;

  const skuExists = state.products.some(p => p.sku === sku && p.id !== id);
  if (skuExists) {
    showToast(`El SKU ${sku} ya está asignado a otro producto.`, 'danger');
    return;
  }

  const autodetected = getProductIconData(name, category);
  const finalIcon = selectedIcon === 'auto' ? autodetected.icon : selectedIcon;
  const finalColor = selectedColor === 'auto' ? autodetected.color : selectedColor;

  if (id) {
    const idx = state.products.findIndex(p => p.id === id);
    if (idx > -1) {
      state.products[idx] = { 
        id, name, sku, category, stock, minStock, costPrice, salePrice, supplierId, 
        icon: finalIcon, 
        color: finalColor,
        posVisible,
        recipe
      };
      showToast('Producto actualizado correctamente');
    }
  } else {
    const newProd = {
      id: 'prod-' + Date.now(),
      name, sku, category, stock, minStock, costPrice, salePrice, supplierId,
      icon: finalIcon,
      color: finalColor,
      posVisible,
      recipe
    };
    state.products.push(newProd);
    showToast('Producto creado con éxito');
  }

  saveStateToLocalStorage();
  closeModal('product-modal');
  renderInventory();
}

function deleteProduct(prodId) {
  if (!checkPermission()) return;

  if (confirm('¿Está seguro de eliminar este producto?')) {
    state.products = state.products.filter(p => p.id !== prodId);
    saveStateToLocalStorage();
    if (supabaseClient) {
      supabaseClient.from('products').delete().eq('id', prodId).then(() => {});
    }
    renderInventory();
    showToast('Producto eliminado del inventario', 'warning');
  }
}
window.deleteProduct = deleteProduct;

// --- VISTA 4: CLIENTES LÓGICA ---
function renderClients(searchQuery = '') {
  const tbody = document.getElementById('clients-tbody');
  tbody.innerHTML = '';

  const query = getNormalizedText(searchQuery);

  const filtered = state.clients.filter(cli => {
    if (!query) return true;
    return getNormalizedText(cli.name).includes(query) ||
           getNormalizedText(cli.rut).includes(query) ||
           getNormalizedText(cli.email).includes(query) ||
           getNormalizedText(cli.phone).includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">No se encontraron clientes registrados.</td></tr>`;
    return;
  }

  filtered.forEach(cli => {
    const clientSales = state.sales.filter(s => s.clientId === cli.id);
    const purchasesCount = clientSales.length;
    const totalSpent = clientSales.reduce((sum, s) => sum + s.total, 0);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${cli.name}</strong></td>
      <td>${cli.rut}</td>
      <td>${cli.phone || '<span class="text-light">N/A</span>'}</td>
      <td>${cli.email || '<span class="text-light">N/A</span>'}</td>
      <td><span class="badge badge-neutral">${purchasesCount} compras</span></td>
      <td><strong style="color: var(--success);"><i class="fa-solid fa-award"></i> $${(cli.points || 0).toLocaleString('es-CL')}</strong></td>
      <td><strong>${formatCurrency(totalSpent)}</strong></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editClient('${cli.id}')" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deleteClient('${cli.id}')" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  applyRoleRestrictions();
}

function openClientModal(cliId = null) {
  const modal = document.getElementById('client-modal');
  const title = document.getElementById('client-modal-title');
  const form = document.getElementById('client-form');
  form.reset();

  if (cliId) {
    const cli = state.clients.find(c => c.id === cliId);
    if (!cli) return;

    title.innerText = 'Editar Cliente';
    document.getElementById('client-id').value = cli.id;
    document.getElementById('client-name').value = cli.name;
    document.getElementById('client-rut').value = cli.rut;
    document.getElementById('client-phone').value = cli.phone;
    document.getElementById('client-email').value = cli.email;
  } else {
    title.innerText = 'Nuevo Cliente';
    document.getElementById('client-id').value = '';
  }

  modal.classList.add('active');
}
window.editClient = openClientModal;

function handleClientFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('client-id').value;
  const name = document.getElementById('client-name').value;
  const rut = document.getElementById('client-rut').value;
  const phone = document.getElementById('client-phone').value;
  const email = document.getElementById('client-email').value;

  const rutExists = state.clients.some(c => c.rut === rut && c.id !== id);
  if (rutExists) {
    showToast(`El cliente con RUT ${rut} ya está registrado.`, 'danger');
    return;
  }

  if (id) {
    const idx = state.clients.findIndex(c => c.id === id);
    if (idx > -1) {
      state.clients[idx] = { ...state.clients[idx], name, rut, phone, email };
      showToast('Cliente actualizado correctamente');
    }
  } else {
    const newClient = {
      id: 'cli-' + Date.now(),
      name, rut, phone, email,
      points: 0,
      createdAt: new Date().toISOString()
    };
    state.clients.push(newClient);
    showToast('Cliente registrado correctamente');
  }

  saveStateToLocalStorage();
  closeModal('client-modal');
  
  if (selectedView === 'pos') {
    renderPOS();
  } else {
    renderClients();
  }
}

function deleteClient(cliId) {
  if (!checkPermission()) return;

  if (confirm('¿Está seguro de eliminar este cliente? Se mantendrá el historial de ventas anteriores como anónimo.')) {
    state.clients = state.clients.filter(c => c.id !== cliId);
    
    state.sales.forEach(sale => {
      if (sale.clientId === cliId) sale.clientId = null;
    });

    saveStateToLocalStorage();
    if (supabaseClient) {
      supabaseClient.from('clients').delete().eq('id', cliId).then(() => {});
    }
    renderClients();
    showToast('Cliente eliminado del directorio', 'warning');
  }
}
window.deleteClient = deleteClient;

// --- VISTA 5: PROVEEDORES LÓGICA ---
function renderSuppliers(searchQuery = '') {
  const tbody = document.getElementById('suppliers-tbody');
  tbody.innerHTML = '';

  const query = getNormalizedText(searchQuery);

  const filtered = state.suppliers.filter(sup => {
    if (!query) return true;
    return getNormalizedText(sup.name).includes(query) ||
           getNormalizedText(sup.rut).includes(query) ||
           getNormalizedText(sup.email).includes(query) ||
           getNormalizedText(sup.phone).includes(query) ||
           getNormalizedText(sup.address).includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 30px;">No se encontraron proveedores.</td></tr>`;
    return;
  }

  filtered.forEach(sup => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${sup.name}</strong></td>
      <td>${sup.rut}</td>
      <td>${sup.phone}</td>
      <td>${sup.email}</td>
      <td><span style="font-size: 12px; color: var(--text-muted);">${sup.address}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editSupplier('${sup.id}')" title="Editar"><i class="fa-solid fa-pen-to-square"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deleteSupplier('${sup.id}')" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  applyRoleRestrictions();
}

function openSupplierModal(supId = null) {
  if (!checkPermission()) return;

  const modal = document.getElementById('supplier-modal');
  const title = document.getElementById('supplier-modal-title');
  const form = document.getElementById('supplier-form');
  form.reset();

  if (supId) {
    const sup = state.suppliers.find(s => s.id === supId);
    if (!sup) return;

    title.innerText = 'Editar Proveedor';
    document.getElementById('supplier-id').value = sup.id;
    document.getElementById('supplier-name').value = sup.name;
    document.getElementById('supplier-rut').value = sup.rut;
    document.getElementById('supplier-phone').value = sup.phone;
    document.getElementById('supplier-email').value = sup.email;
    document.getElementById('supplier-address').value = sup.address;
  } else {
    title.innerText = 'Nuevo Proveedor';
    document.getElementById('supplier-id').value = '';
  }

  modal.classList.add('active');
}
window.editSupplier = openSupplierModal;

function handleSupplierFormSubmit(e) {
  e.preventDefault();
  if (!checkPermission()) return;

  const id = document.getElementById('supplier-id').value;
  const name = document.getElementById('supplier-name').value;
  const rut = document.getElementById('supplier-rut').value;
  const phone = document.getElementById('supplier-phone').value;
  const email = document.getElementById('supplier-email').value;
  const address = document.getElementById('supplier-address').value;

  const rutExists = state.suppliers.some(s => s.rut === rut && s.id !== id);
  if (rutExists) {
    showToast(`El proveedor con RUT ${rut} ya existe.`, 'danger');
    return;
  }

  if (id) {
    const idx = state.suppliers.findIndex(s => s.id === id);
    if (idx > -1) {
      state.suppliers[idx] = { id, name, rut, phone, email, address };
      showToast('Proveedor actualizado con éxito');
    }
  } else {
    const newSup = {
      id: 'prov-' + Date.now(),
      name, rut, phone, email, address
    };
    state.suppliers.push(newSup);
    showToast('Proveedor creado correctamente');
  }

  saveStateToLocalStorage();
  closeModal('supplier-modal');
  renderSuppliers();
}

function deleteSupplier(supId) {
  if (!checkPermission()) return;

  const countProd = state.products.filter(p => p.supplierId === supId).length;
  if (countProd > 0) {
    showToast(`No es posible eliminar el proveedor. Tiene ${countProd} productos asociados en el inventario.`, 'danger');
    return;
  }

  if (confirm('¿Está seguro de eliminar este proveedor?')) {
    state.suppliers = state.suppliers.filter(s => s.id !== supId);
    saveStateToLocalStorage();
    if (supabaseClient) {
      supabaseClient.from('suppliers').delete().eq('id', supId).then(() => {});
    }
    renderSuppliers();
    showToast('Proveedor eliminado del registro', 'warning');
  }
}
window.deleteSupplier = deleteSupplier;

// --- VISTA 6: REPORTES Y GRÁFICOS (CHART.JS) ---
function renderReports() {
  const periodIndicator = document.getElementById('report-period-text');
  const now = new Date();
  
  let filteredSales = [];
  let labels = [];
  let salesDataArray = [];
  let labelPeriodDesc = '';

  if (currentReportRange === 'diario') {
    labelPeriodDesc = `Hoy: ${now.toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    filteredSales = state.sales.filter(s => new Date(s.date).toDateString() === now.toDateString());
    
    labels = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
    salesDataArray = Array(labels.length).fill(0);
    
    filteredSales.forEach(s => {
      const hour = new Date(s.date).getHours();
      if (hour < 9) salesDataArray[0] += s.total;
      else if (hour < 11) salesDataArray[1] += s.total;
      else if (hour < 13) salesDataArray[2] += s.total;
      else if (hour < 15) salesDataArray[3] += s.total;
      else if (hour < 17) salesDataArray[4] += s.total;
      else if (hour < 19) salesDataArray[5] += s.total;
      else salesDataArray[6] += s.total;
    });

  } else if (currentReportRange === 'semanal') {
    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 6);
    labelPeriodDesc = `Semana: del ${weekAgo.toLocaleDateString('es-CL', {day:'numeric', month:'short'})} al ${now.toLocaleDateString('es-CL', {day:'numeric', month:'short'})}`;
    
    filteredSales = state.sales.filter(s => {
      const sDate = new Date(s.date);
      return sDate >= new Date(weekAgo.setHours(0,0,0,0)) && sDate <= now;
    });

    for (let k = 6; k >= 0; k--) {
      const d = new Date();
      d.setDate(now.getDate() - k);
      const dayLabel = d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' });
      labels.push(dayLabel);
      
      const daySum = filteredSales
        .filter(s => new Date(s.date).toDateString() === d.toDateString())
        .reduce((sum, s) => sum + s.total, 0);
      salesDataArray.push(daySum);
    }

  } else if (currentReportRange === 'mensual') {
    const monthAgo = new Date();
    monthAgo.setDate(now.getDate() - 29);
    labelPeriodDesc = `Mes: últimos 30 días (${monthAgo.toLocaleDateString('es-CL', {day:'numeric', month:'short'})} - ${now.toLocaleDateString('es-CL', {day:'numeric'})})`;
    
    filteredSales = state.sales.filter(s => {
      const sDate = new Date(s.date);
      return sDate >= new Date(monthAgo.setHours(0,0,0,0)) && sDate <= now;
    });

    labels = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
    salesDataArray = Array(4).fill(0);
    
    filteredSales.forEach(s => {
      const diffTime = Math.abs(now - new Date(s.date));
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays <= 7) salesDataArray[3] += s.total;
      else if (diffDays <= 14) salesDataArray[2] += s.total;
      else if (diffDays <= 21) salesDataArray[1] += s.total;
      else salesDataArray[0] += s.total;
    });

  } else if (currentReportRange === 'anual') {
    labelPeriodDesc = `Anual: Ventas agrupadas por mes (${now.getFullYear()})`;
    filteredSales = state.sales.filter(s => new Date(s.date).getFullYear() === now.getFullYear());

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    labels = monthNames;
    salesDataArray = Array(12).fill(0);

    filteredSales.forEach(s => {
      const monthIdx = new Date(s.date).getMonth();
      salesDataArray[monthIdx] += s.total;
    });
  } else if (currentReportRange === 'mes-especifico') {
    const monthVal = document.getElementById('report-month-picker').value;
    if (monthVal) {
      const [yearStr, monthStr] = monthVal.split('-');
      const targetYear = parseInt(yearStr);
      const targetMonth = parseInt(monthStr) - 1; // 0-indexed
      
      const tempDate = new Date(targetYear, targetMonth, 1);
      const monthName = tempDate.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
      labelPeriodDesc = `Mes: ${capitalize(monthName)}`;
      
      filteredSales = state.sales.filter(s => {
        const sDate = new Date(s.date);
        return sDate.getFullYear() === targetYear && sDate.getMonth() === targetMonth;
      });
      
      const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
      
      labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
      salesDataArray = Array(daysInMonth).fill(0);
      
      filteredSales.forEach(s => {
        const day = new Date(s.date).getDate();
        salesDataArray[day - 1] += s.total;
      });
    } else {
      labelPeriodDesc = 'Ningún mes seleccionado';
    }
  }

  periodIndicator.innerText = labelPeriodDesc;

  const totalRev = filteredSales.reduce((sum, s) => sum + s.total, 0);
  const salesCount = filteredSales.length;
  const avgTicket = salesCount > 0 ? Math.round(totalRev / salesCount) : 0;
  
  let totalDiscounts = 0;
  filteredSales.forEach(s => {
    let saleSub = s.subtotal;
    let saleTot = s.total;
    totalDiscounts += Math.max(0, saleSub - saleTot);
  });

  const totalNeto = filteredSales.reduce((sum, s) => sum + (s.neto || Math.round(s.total / 1.19)), 0);
  const totalIva = filteredSales.reduce((sum, s) => sum + (s.iva || (s.total - Math.round(s.total / 1.19))), 0);
  const totalProfit = filteredSales.reduce((sum, s) => {
    if (s.profit !== undefined) return sum + s.profit;
    const cost = s.items.reduce((acc, item) => {
      const prod = state.products.find(p => p.id === item.productId);
      const c = prod ? Number(prod.costPrice) : 0;
      return acc + (c * item.quantity);
    }, 0);
    return sum + (s.total - cost);
  }, 0);

  document.getElementById('rep-total-sales').innerText = formatCurrency(totalRev);
  document.getElementById('rep-total-neto').innerText = formatCurrency(totalNeto);
  document.getElementById('rep-total-iva').innerText = formatCurrency(totalIva);
  document.getElementById('rep-total-profit').innerText = formatCurrency(totalProfit);
  document.getElementById('rep-sales-count').innerText = salesCount;
  document.getElementById('rep-avg-ticket').innerText = formatCurrency(avgTicket);
  document.getElementById('rep-total-discounts').innerText = formatCurrency(totalDiscounts);

  // --- RENDER DE GRÁFICO ---
  const ctx = document.getElementById('salesChart').getContext('2d');
  
  if (salesChartInstance) {
    salesChartInstance.destroy();
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(29, 78, 216, 0.3)');
  gradient.addColorStop(1, 'rgba(29, 78, 216, 0.0)');

  salesChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Ventas ($)',
        data: salesDataArray,
        borderColor: '#1d4ed8',
        borderWidth: 3,
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#1d4ed8',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          padding: 12,
          backgroundColor: '#0f172a',
          titleFont: { size: 13, family: 'Outfit' },
          bodyFont: { size: 14, family: 'Outfit', weight: 'bold' },
          callbacks: {
            label: function(context) {
              return `Recaudado: ${formatCurrency(context.raw)}`;
            }
          }
        }
      },
      scales: {
        y: {
          grid: {
            color: '#f1f5f9'
          },
          ticks: {
            font: { family: 'Outfit', size: 11 },
            callback: function(value) {
              return formatCurrency(value);
            }
          }
        },
        x: {
          grid: {
            display: false
          },
          ticks: {
            font: { family: 'Outfit', size: 11 }
          }
        }
      }
    }
  });

  const topProductsTbody = document.getElementById('rep-top-products-tbody');
  topProductsTbody.innerHTML = '';

  const prodRanking = {};
  filteredSales.forEach(sale => {
    sale.items.forEach(item => {
      if (!prodRanking[item.productId]) {
        prodRanking[item.productId] = { name: item.name, quantity: 0, revenue: 0 };
      }
      prodRanking[item.productId].quantity += item.quantity;
      prodRanking[item.productId].revenue += item.total;
    });
  });

  const sortedProducts = Object.values(prodRanking).sort((a, b) => b.quantity - a.quantity).slice(0, 5);

  if (sortedProducts.length === 0) {
    topProductsTbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 20px;">Sin transacciones en este rango.</td></tr>`;
  } else {
    sortedProducts.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${p.name}</strong></td>
        <td><span class="badge badge-neutral">${p.quantity} unidades</span></td>
        <td><strong>${formatCurrency(p.revenue)}</strong></td>
      `;
      topProductsTbody.appendChild(tr);
    });
  }

  const salesHistoryTbody = document.getElementById('rep-sales-history-tbody');
  salesHistoryTbody.innerHTML = '';

  const sortedSalesPeriod = [...filteredSales].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (sortedSalesPeriod.length === 0) {
    salesHistoryTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 20px;">Sin registros de ventas.</td></tr>`;
  } else {
    sortedSalesPeriod.forEach(sale => {
      const client = state.clients.find(c => c.id === sale.clientId);
      const clientName = client ? client.name : 'Cliente Anónimo';
      
      const sDateObj = new Date(sale.date);
      const formattedDate = `${sDateObj.toLocaleDateString('es-CL')} ${sDateObj.toLocaleTimeString('es-CL', {hour: '2-digit', minute:'2-digit'})}`;

      let discAmount = sale.subtotal - sale.total;

      const tr = document.createElement('tr');
      tr.style.cursor = 'pointer';
      tr.title = 'Haga clic para ver el desglose de la venta';
      tr.innerHTML = `
        <td>${formattedDate}</td>
        <td>${clientName}</td>
        <td><strong>${formatCurrency(sale.total)}</strong></td>
        <td class="${discAmount > 0 ? 'text-warning' : 'text-light'}">${discAmount > 0 ? `-${formatCurrency(discAmount)}` : '$0'}</td>
        <td><span class="badge badge-neutral">${capitalize(sale.paymentMethod)}</span></td>
      `;
      tr.addEventListener('click', () => {
        viewSaleDetails(sale.id);
      });
      salesHistoryTbody.appendChild(tr);
    });
  }
}

// --- UTILERÍAS ---
function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}
window.openModal = openModal;

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}
window.closeModal = closeModal;

function formatCurrency(val) {
  return '$' + Math.round(val).toLocaleString('es-CL');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// --- MAQUILLADOR / MAPEO DE ICONOS VECTORIALES Y COLORES DE FONDO PLANOS (FLAT DESIGN) ---
function getProductIconData(name, category) {
  const clean = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  
  let icon = 'fa-solid fa-box';
  let color = '#64748b'; // Slate fallback
  
  // Paleta de Colores Planos Modernos
  const palette = {
    blue: '#2563eb',     // Café, vaso térmico
    teal: '#0d9488',     // Té e Infusiones
    orange: '#ea580c',   // Sándwiches / Comida salada
    amber: '#ca8a04',    // Repostería / Cookies / Muffins
    emerald: '#16a34a',  // Jugos, Aguas
    rose: '#db2777',     // Frutos rojos / especialidad
    indigo: '#4f46e5',   // Accesorios, varios
    sky: '#0284c7'       // Bebidas frías / latas / soda
  };

  // 1. Mapeo específico por palabras en el NOMBRE del producto (50 opciones integradas)
  // [1] Espresso
  if (clean.includes('espresso') || clean.includes('expreso') || clean.includes('ristretto')) {
    icon = 'fa-solid fa-mug-hot';
    color = '#451a03'; // Marrón espresso oscuro
  }
  // [2] Capuccino / Moka
  else if (clean.includes('capuccino') || clean.includes('cappuccino') || clean.includes('mokaccino') || clean.includes('moka')) {
    icon = 'fa-solid fa-mug-hot';
    color = '#78350f'; // Café con leche
  }
  // [3] Latte / Cortado
  else if (clean.includes('latte') || clean.includes('cortado') || clean.includes('lagrima') || clean.includes('macchiato')) {
    icon = 'fa-solid fa-mug-hot';
    color = '#92400e'; // Café claro
  }
  // [4] Café Americano / Filtrado
  else if (clean.includes('americano') || clean.includes('filtrado') || clean.includes('cafe') || clean.includes('coffee')) {
    icon = 'fa-solid fa-mug-hot';
    color = '#9a3412'; // Café clásico
  }
  // [5] Chocolate Caliente
  else if (clean.includes('chocolate caliente') || clean.includes('cacao') || clean.includes('submarino') || clean.includes('hot chocolate')) {
    icon = 'fa-solid fa-mug-hot';
    color = '#3f2212'; // Chocolate
  }
  // [6] Matcha
  else if (clean.includes('matcha')) {
    icon = 'fa-solid fa-leaf';
    color = '#84cc16'; // Verde matcha
  }
  // [7] Té Verde
  else if (clean.includes('te verde') || clean.includes('green tea')) {
    icon = 'fa-solid fa-leaf';
    color = '#15803d'; // Verde oscuro
  }
  // [8] Té Chai
  else if (clean.includes('chai')) {
    icon = 'fa-solid fa-leaf';
    color = '#b45309'; // Dorado chai
  }
  // [9] Té de hierbas / Infusiones
  else if (clean.includes('te ') || clean.includes('tea') || clean.includes('infusion') || clean.includes('menta') || clean.includes('manzanilla') || clean.includes('boldo') || clean.includes('cedron') || clean.includes('hierba')) {
    icon = 'fa-solid fa-leaf';
    color = '#0d9488'; // Turquesa/Teal
  }
  // [10] Coca Cola / Coke
  else if (clean.includes('coca') || clean.includes('coke') || clean.includes('pepsi')) {
    icon = 'fa-solid fa-bottle-water';
    color = '#ef4444'; // Rojo Coca-Cola
  }
  // [11] Sprite
  else if (clean.includes('sprite') || clean.includes('kem')) {
    icon = 'fa-solid fa-bottle-water';
    color = '#10b981'; // Verde Sprite
  }
  // [12] Fanta
  else if (clean.includes('fanta') || clean.includes('crush') || clean.includes('pap')) {
    icon = 'fa-solid fa-bottle-water';
    color = '#f97316'; // Naranja Fanta
  }
  // [13] Bebidas y Latas Generales
  else if (clean.includes('soda') || clean.includes('bebida') || clean.includes('gaseosa') || clean.includes('lata')) {
    icon = 'fa-solid fa-bottle-water';
    color = '#0284c7'; // Celeste/Sky
  }
  // [14] Jugo de Naranja
  else if (clean.includes('naranja') || clean.includes('orange')) {
    icon = 'fa-solid fa-glass-water';
    color = '#ea580c'; // Naranja fuerte
  }
  // [15] Jugo de Frutilla / Berries
  else if (clean.includes('frutilla') || clean.includes('frambuesa') || clean.includes('arandano') || clean.includes('berry') || clean.includes('berries') || clean.includes('frutos rojos') || clean.includes('mora')) {
    icon = 'fa-solid fa-glass-water';
    color = '#db2777'; // Rosado berries
  }
  // [16] Jugo y Smoothie General
  else if (clean.includes('jugo') || clean.includes('juice') || clean.includes('smoothie') || clean.includes('batido') || clean.includes('licuado')) {
    icon = 'fa-solid fa-glass-water';
    color = '#ec4899'; // Rosa chicle
  }
  // [17] Limonada
  else if (clean.includes('limonada') || clean.includes('lemonade') || clean.includes('limon') || clean.includes('lemon')) {
    icon = 'fa-solid fa-glass-water';
    color = '#ca8a04'; // Amarillo limón
  }
  // [18] Agua Mineral
  else if (clean.includes('agua') || clean.includes('water') || clean.includes('mineral')) {
    icon = 'fa-solid fa-droplet';
    color = '#38bdf8'; // Celeste claro
  }
  // [19] Cerveza y Schops
  else if (clean.includes('cerveza') || clean.includes('beer') || clean.includes('schop') || clean.includes('pilsener') || clean.includes('ipa')) {
    icon = 'fa-solid fa-beer-mug-empty';
    color = '#f59e0b'; // Amarillo dorado cerveza
  }
  // [20] Vino
  else if (clean.includes('vino') || clean.includes('wine') || clean.includes('tinto') || clean.includes('blanco') || clean.includes('copa')) {
    icon = 'fa-solid fa-wine-glass';
    color = '#7f1d1d'; // Burdeos/Vino tinto
  }
  // [21] Cócteles
  else if (clean.includes('trago') || clean.includes('cocktail') || clean.includes('sour') || clean.includes('mojito') || clean.includes('piscola') || clean.includes('aperol') || clean.includes('coctel')) {
    icon = 'fa-solid fa-martini-glass-citrus';
    color = '#4f46e5'; // Indigo/Cóctel
  }
  // [22] Queso
  else if (clean.includes('queso') || clean.includes('cheese') || clean.includes('mantecoso') || clean.includes('chedar') || clean.includes('cheddar') || clean.includes('provoleta') || clean.includes('melt')) {
    icon = 'fa-solid fa-cheese';
    color = '#facc15'; // Amarillo queso
  }
  // [23] Jamón / Tocino / Bacon
  else if (clean.includes('jamon') || clean.includes('bacon') || clean.includes('tocino') || clean.includes('panceta')) {
    icon = 'fa-solid fa-bacon';
    color = '#f43f5e'; // Rosado tocino
  }
  // [24] Huevos / Desayunos
  else if (clean.includes('huevo') || clean.includes('egg') || clean.includes('paila') || clean.includes('omelette') || clean.includes('huevito')) {
    icon = 'fa-solid fa-egg';
    color = '#fef08a'; // Amarillo huevo
  }
  // [25] Sándwich / Aliado
  else if (clean.includes('sandwich') || clean.includes('aliado') || clean.includes('churrasco') || clean.includes('lomito') || clean.includes('luco') || clean.includes('jarpa')) {
    icon = 'fa-solid fa-bread-slice';
    color = '#ea580c'; // Naranja pan
  }
  // [26] Ciabatta / Pan / Baguette
  else if (clean.includes('ciabatta') || clean.includes('pan ') || clean.includes('baguette') || clean.includes('marraqueta') || clean.includes('hallulla') || clean.includes('tostada') || clean.includes('tostado')) {
    icon = 'fa-solid fa-bread-slice';
    color = '#d97706'; // Pan horneado
  }
  // [27] Empanadas
  else if (clean.includes('empanada') || clean.includes('pino')) {
    icon = 'fa-solid fa-bread-slice';
    color = '#ca8a04';
  }
  // [28] Croissant / Medialuna
  else if (clean.includes('croissant') || clean.includes('medialuna') || clean.includes('factura')) {
    icon = 'fa-solid fa-cookie';
    color = '#b45309'; // Dorado croissant
  }
  // [29] Muffins / Cupcakes
  else if (clean.includes('muffin') || clean.includes('cupcake') || clean.includes('queque')) {
    icon = 'fa-solid fa-cake-candles';
    color = '#d97706';
  }
  // [30] Galletas
  else if (clean.includes('galleta') || clean.includes('cookie')) {
    icon = 'fa-solid fa-cookie-bite';
    color = '#d97706';
  }
  // [31] Tortas / Pasteles / Kuchen
  else if (clean.includes('torta') || clean.includes('tarta') || clean.includes('pastel') || clean.includes('pie') || clean.includes('kuchen')) {
    icon = 'fa-solid fa-cake-candles';
    color = '#db2777'; // Rosado dulce
  }
  // [32] Helados
  else if (clean.includes('helado') || clean.includes('ice cream') || clean.includes('paleta') || clean.includes('sorbete')) {
    icon = 'fa-solid fa-ice-cream';
    color = '#f472b6'; // Rosa helado
  }
  // [33] Waffles / Panqueques
  else if (clean.includes('waffle') || clean.includes('panqueque') || clean.includes('crepe') || clean.includes('pancake')) {
    icon = 'fa-solid fa-stroopwafel';
    color = '#b45309';
  }
  // [34] Carne de Vacuno
  else if (clean.includes('carne') || clean.includes('vacuno') || clean.includes('lomo') || clean.includes('asado') || clean.includes('mechada') || clean.includes('bife') || clean.includes('filete') || clean.includes('plateada')) {
    icon = 'fa-solid fa-bacon';
    color = '#b91c1c'; // Rojo carne
  }
  // [35] Pollo / Ave
  else if (clean.includes('pollo') || clean.includes('chicken') || clean.includes('ave') || clean.includes('pechuga') || clean.includes('nugget')) {
    icon = 'fa-solid fa-drumstick-bite';
    color = '#f97316'; // Naranja pollo
  }
  // [36] Pescado
  else if (clean.includes('pescado') || clean.includes('fish') || clean.includes('salmon') || clean.includes('reineta') || clean.includes('atun')) {
    icon = 'fa-solid fa-fish';
    color = '#06b6d4'; // Azul cian
  }
  // [37] Mariscos
  else if (clean.includes('marisco') || clean.includes('camaron') || clean.includes('shrimp') || clean.includes('ostion') || clean.includes('calamar')) {
    icon = 'fa-solid fa-shrimp';
    color = '#f43f5e'; // Coral
  }
  // [38] Arroz / Risotto
  else if (clean.includes('arroz') || clean.includes('rice') || clean.includes('chaufa') || clean.includes('risotto')) {
    icon = 'fa-solid fa-bowl-rice';
    color = '#cbd5e1'; // Gris
  }
  // [39] Fideos / Pastas / Ramen
  else if (clean.includes('fideos') || clean.includes('tallarines') || clean.includes('pasta') || clean.includes('spaghetti') || clean.includes('ramen') || clean.includes('ravioles') || clean.includes('lasaña')) {
    icon = 'fa-solid fa-bowl-food';
    color = '#c026d3'; // Fucsia pasta
  }
  // [40] Hamburguesas
  else if (clean.includes('hamburguesa') || clean.includes('burger')) {
    icon = 'fa-solid fa-burger';
    color = '#854d0e'; // Café hamburguesa
  }
  // [41] Papas Fritas
  else if (clean.includes('papas fritas') || clean.includes('papas') || clean.includes('fries') || clean.includes('fritas') || clean.includes('rusticas')) {
    icon = 'fa-solid fa-burger';
    color = '#eab308'; // Amarillo papa
  }
  // [42] Pizzas
  else if (clean.includes('pizza') || clean.includes('pizzeta') || clean.includes('fugazza')) {
    icon = 'fa-solid fa-pizza-slice';
    color = '#ea580c'; // Naranja
  }
  // [43] Completos / Hot Dogs
  else if (clean.includes('completo') || clean.includes('hotdog') || clean.includes('vienesa') || clean.includes('salchicha')) {
    icon = 'fa-solid fa-hotdog';
    color = '#dc2626'; // Rojo completo
  }
  // [44] Ensaladas / Verduras
  else if (clean.includes('ensalada') || clean.includes('salad') || clean.includes('lechuga') || clean.includes('tomate') || clean.includes('zanahoria') || clean.includes('apio') || clean.includes('palta') || clean.includes('vegetal') || clean.includes('verdur') || clean.includes('espinaca')) {
    icon = 'fa-solid fa-leaf';
    color = '#22c55e'; // Verde
  }
  // [45] Sopas / Cremas
  else if (clean.includes('sopa') || clean.includes('caldo') || clean.includes('crema') || clean.includes('consome')) {
    icon = 'fa-solid fa-bowl-food';
    color = '#d97706'; // Ambar
  }
  // [46] Mermeladas y Manjar
  else if (clean.includes('mermelada') || clean.includes('miel') || clean.includes('manjar') || clean.includes('nutella')) {
    icon = 'fa-solid fa-cookie-bite';
    color = '#ca8a04';
  }
  // [47] Frutas naturales
  else if (clean.includes('manzana') || clean.includes('platano') || clean.includes('banana') || clean.includes('fruta') || clean.includes('kiwi') || clean.includes('durazno') || clean.includes('melon') || clean.includes('frutilla') || clean.includes('piña')) {
    icon = 'fa-solid fa-apple-whole';
    color = '#f43f5e';
  }
  // [48] Limón / Sour
  else if (clean.includes('limon') || clean.includes('sour') || clean.includes('pisco sour')) {
    icon = 'fa-solid fa-lemon';
    color = '#eab308';
  }
  // [49] Ají / Picante
  else if (clean.includes('aji') || clean.includes('chile') || clean.includes('picante') || clean.includes('merquen') || clean.includes('merquén')) {
    icon = 'fa-solid fa-pepper-hot';
    color = '#dc2626';
  }
  // [50] Varios / Artículos / Bazar
  else if (clean.includes('vaso') || clean.includes('termo') || clean.includes('taza') || clean.includes('mug') || clean.includes('bazar') || clean.includes('souvenir') || clean.includes('regalo') || clean.includes('accesorio') || clean.includes('bolsa')) {
    icon = 'fa-solid fa-mug-saucer';
    color = '#6366f1';
  }
  
  // 2. Mapeo genérico por CATEGORÍA (si el nombre no arrojó coincidencias)
  if (icon === 'fa-solid fa-box') {
    switch (category) {
      case 'Café':
        icon = 'fa-solid fa-mug-hot';
        color = palette.blue;
        break;
      case 'Té e Infusiones':
        icon = 'fa-solid fa-leaf';
        color = palette.teal;
        break;
      case 'Repostería':
        icon = 'fa-solid fa-cookie';
        color = palette.amber;
        break;
      case 'Sándwiches':
        icon = 'fa-solid fa-bread-slice';
        color = palette.orange;
        break;
      case 'Bebidas Frías':
        icon = 'fa-solid fa-glass-water';
        color = palette.emerald;
        break;
      case 'Accesorios':
        icon = 'fa-solid fa-tag';
        color = palette.indigo;
        break;
    }
  }

  return { icon, color };
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return hash;
}

// --- SISTEMA DE RESPALDO Y RESTAURACIÓN (COPIA DE SEGURIDAD GENERAL) ---
function exportBackup() {
  try {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const downloadAnchor = document.createElement('a');
    downloadAnchor.href = url;
    
    const now = new Date();
    const dateString = now.toISOString().split('T')[0];
    downloadAnchor.download = `coffeelab_respaldo_${dateString}.json`;
    
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    
    document.body.removeChild(downloadAnchor);
    URL.revokeObjectURL(url);
    
    showToast('Copia de seguridad exportada con éxito', 'success');
  } catch (err) {
    showToast('Error al exportar la copia de seguridad', 'danger');
  }
}
window.exportBackup = exportBackup;

function resetSystemToFactory() {
  if (confirm('¿Estás seguro de que deseas vaciar por completo el sistema? Se borrarán todos los productos, ventas, clientes y proveedores de forma permanente.')) {
    localStorage.clear();
    localStorage.setItem('p41_cleared', 'true');
    state = { products: [], clients: [], suppliers: [], sales: [] };
    cart = [];
    cartDiscount = { value: 0, type: 'percent' };
    
    saveStateToLocalStorage();
    localStorage.setItem('p41_cleared', 'true'); // Asegurar persistencia del flag
    
    navigateTo('dashboard');
    showToast('Sistema vaciado por completo. Listo para iniciar desde cero.', 'success');
  }
}
window.resetSystemToFactory = resetSystemToFactory;

function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedState = JSON.parse(e.target.result);
      
      // Validar estructura básica
      if (importedState.products && importedState.clients && importedState.suppliers && importedState.sales) {
        state = importedState;
        saveStateToLocalStorage();
        
        // Recargar base de datos local y refrescar vistas
        loadStateFromLocalStorage();
        navigateTo(selectedView);
        
        showToast('Base de datos restaurada con éxito', 'success');
      } else {
        showToast('El archivo de respaldo no tiene el formato correcto de coffeelab', 'danger');
      }
    } catch (err) {
      showToast('Error al leer el archivo de respaldo', 'danger');
    }
  };
  reader.readAsText(file);
  
  // Limpiar input file
  event.target.value = '';
}
window.importBackup = importBackup;

// --- SISTEMA DE EXPORTACIÓN CORPORATIVA A PDF (FORMATO IMPRESIÓN A4) ---
function getFilteredSalesForReport() {
  const now = new Date();
  let filteredSales = [];
  if (currentReportRange === 'diario') {
    filteredSales = state.sales.filter(s => new Date(s.date).toDateString() === now.toDateString());
  } else if (currentReportRange === 'semanal') {
    const weekAgo = new Date();
    weekAgo.setDate(now.getDate() - 6);
    filteredSales = state.sales.filter(s => {
      const sDate = new Date(s.date);
      return sDate >= new Date(weekAgo.setHours(0,0,0,0)) && sDate <= now;
    });
  } else if (currentReportRange === 'mensual') {
    const monthAgo = new Date();
    monthAgo.setDate(now.getDate() - 29);
    filteredSales = state.sales.filter(s => {
      const sDate = new Date(s.date);
      return sDate >= new Date(monthAgo.setHours(0,0,0,0)) && sDate <= now;
    });
  } else if (currentReportRange === 'anual') {
    filteredSales = state.sales.filter(s => new Date(s.date).getFullYear() === now.getFullYear());
  } else if (currentReportRange === 'mes-especifico') {
    const monthVal = document.getElementById('report-month-picker').value;
    if (monthVal) {
      const [yearStr, monthStr] = monthVal.split('-');
      const targetYear = parseInt(yearStr);
      const targetMonth = parseInt(monthStr) - 1;
      filteredSales = state.sales.filter(s => {
        const sDate = new Date(s.date);
        return sDate.getFullYear() === targetYear && sDate.getMonth() === targetMonth;
      });
    }
  }
  return filteredSales;
}

function exportSalesReportPDF() {
  const sales = getFilteredSalesForReport();
  const totalRev = sales.reduce((sum, s) => sum + s.total, 0);
  const salesCount = sales.length;
  const avgTicket = salesCount > 0 ? Math.round(totalRev / salesCount) : 0;
  
  let totalDiscounts = 0;
  sales.forEach(s => {
    totalDiscounts += Math.max(0, s.subtotal - s.total);
  });

  let periodLabel = 'Reporte Diario';
  if (currentReportRange === 'semanal') periodLabel = 'Reporte Semanal';
  else if (currentReportRange === 'mensual') periodLabel = 'Reporte Mensual (Últimos 30 días)';
  else if (currentReportRange === 'anual') periodLabel = `Reporte Anual (${new Date().getFullYear()})`;
  else if (currentReportRange === 'mes-especifico') {
    const monthVal = document.getElementById('report-month-picker').value;
    if (monthVal) {
      const [y, m] = monthVal.split('-');
      const tempDate = new Date(parseInt(y), parseInt(m) - 1, 1);
      periodLabel = `Reporte Mensual - ${capitalize(tempDate.toLocaleDateString('es-CL', { month: 'long', year: 'numeric' }))}`;
    }
  }

  const container = document.getElementById('print-report-template');
  container.innerHTML = `
    <div class="corporate-report-header">
      <div class="corporate-report-brand">
        <h1>Punto 41</h1>
        <span>coffeelab</span>
      </div>
      <div class="corporate-report-title-section">
        <h2>${periodLabel}</h2>
        <p>Generado el: ${new Date().toLocaleDateString('es-CL')} ${new Date().toLocaleTimeString('es-CL')}</p>
      </div>
    </div>

    <div class="corporate-report-summary-grid">
      <div class="corporate-report-summary-card">
        <h4>Total Recaudado</h4>
        <p>${formatCurrency(totalRev)}</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Transacciones</h4>
        <p>${salesCount}</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Ticket Promedio</h4>
        <p>${formatCurrency(avgTicket)}</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Descuentos</h4>
        <p>${formatCurrency(totalDiscounts)}</p>
      </div>
    </div>

    <table class="corporate-report-table">
      <thead>
        <tr>
          <th>Fecha y Hora</th>
          <th>Venta ID</th>
          <th>Cliente</th>
          <th>Medio de Pago</th>
          <th style="text-align: right;">Descuentos</th>
          <th style="text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${sales.length === 0 ? `<tr><td colspan="6" style="text-align: center;">No hay transacciones registradas en este período.</td></tr>` : 
          sales.map(s => {
            const sDate = new Date(s.date);
            const cli = state.clients.find(c => c.id === s.clientId);
            const clientName = cli ? cli.name : 'Cliente Anónimo';
            const disc = s.subtotal - s.total;
            return `
              <tr>
                <td>${sDate.toLocaleDateString('es-CL')} ${sDate.toLocaleTimeString('es-CL', {hour: '2-digit', minute: '2-digit'})}</td>
                <td><strong>${s.id}</strong></td>
                <td>${clientName}</td>
                <td>${capitalize(s.paymentMethod)}</td>
                <td style="text-align: right; color: var(--warning);">${disc > 0 ? `-${formatCurrency(disc)}` : '$0'}</td>
                <td style="text-align: right;"><strong>${formatCurrency(s.total)}</strong></td>
              </tr>
            `;
          }).join('')
        }
      </tbody>
    </table>

    <div class="corporate-report-footer">
      <p>coffeelab - Sistema de Gestión y POS. Copyright © ${new Date().getFullYear()} Punto 41.</p>
    </div>
  `;

  triggerPDFPrint();
}
window.exportSalesReportPDF = exportSalesReportPDF;

function exportInventoryPDF() {
  const searchInput = document.getElementById('inventory-search');
  const query = getNormalizedText(searchInput ? searchInput.value : '');
  
  const filtered = state.products.filter(p => {
    if (!query) return true;
    const prov = state.suppliers.find(s => s.id === p.supplierId);
    const provName = prov ? prov.name : '';
    return getNormalizedText(p.name).includes(query) ||
           getNormalizedText(p.sku).includes(query) ||
           getNormalizedText(p.category).includes(query) ||
           getNormalizedText(provName).includes(query);
  });

  const totalItems = filtered.length;
  const totalStock = filtered.reduce((sum, p) => sum + Number(p.stock), 0);
  const totalCostVal = filtered.reduce((sum, p) => sum + (Number(p.costPrice) * Number(p.stock)), 0);
  const totalRetailVal = filtered.reduce((sum, p) => sum + (Number(p.salePrice) * Number(p.stock)), 0);

  const container = document.getElementById('print-report-template');
  container.innerHTML = `
    <div class="corporate-report-header">
      <div class="corporate-report-brand">
        <h1>Punto 41</h1>
        <span>coffeelab</span>
      </div>
      <div class="corporate-report-title-section">
        <h2>Reporte de Inventario de Productos</h2>
        <p>Generado el: ${new Date().toLocaleDateString('es-CL')} ${new Date().toLocaleTimeString('es-CL')}</p>
      </div>
    </div>

    <div class="corporate-report-summary-grid">
      <div class="corporate-report-summary-card">
        <h4>Ítems Registrados</h4>
        <p>${totalItems}</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Stock Total</h4>
        <p>${totalStock} uds</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Valorización Costo</h4>
        <p>${formatCurrency(totalCostVal)}</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Valorización Venta</h4>
        <p>${formatCurrency(totalRetailVal)}</p>
      </div>
    </div>

    <table class="corporate-report-table">
      <thead>
        <tr>
          <th>SKU</th>
          <th>Producto</th>
          <th>Categoría</th>
          <th style="text-align: right;">Costo</th>
          <th style="text-align: right;">Venta</th>
          <th style="text-align: center;">Stock</th>
          <th>Proveedor</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.length === 0 ? `<tr><td colspan="7" style="text-align: center;">No hay productos en inventario.</td></tr>` : 
          filtered.map(p => {
            const prov = state.suppliers.find(s => s.id === p.supplierId);
            const provName = prov ? prov.name : 'Sin Proveedor';
            const isLow = Number(p.stock) <= Number(p.minStock);
            return `
              <tr>
                <td><strong>${p.sku}</strong></td>
                <td>${p.name}</td>
                <td>${p.category}</td>
                <td style="text-align: right;">${formatCurrency(p.costPrice)}</td>
                <td style="text-align: right;"><strong>${formatCurrency(p.salePrice)}</strong></td>
                <td style="text-align: center; font-weight: bold; color: ${isLow ? '#dc2626' : 'inherit'}">${p.stock} ${isLow ? '⚠️' : ''}</td>
                <td>${provName}</td>
              </tr>
            `;
          }).join('')
        }
      </tbody>
    </table>

    <div class="corporate-report-footer">
      <p>coffeelab - Sistema de Gestión y POS. Copyright © ${new Date().getFullYear()} Punto 41.</p>
    </div>
  `;

  triggerPDFPrint();
}
window.exportInventoryPDF = exportInventoryPDF;

function exportClientsPDF() {
  const searchInput = document.getElementById('clients-search');
  const query = getNormalizedText(searchInput ? searchInput.value : '');

  const filtered = state.clients.filter(cli => {
    if (!query) return true;
    return getNormalizedText(cli.name).includes(query) ||
           getNormalizedText(cli.rut).includes(query) ||
           getNormalizedText(cli.email).includes(query) ||
           getNormalizedText(cli.phone).includes(query);
  });

  const totalClients = filtered.length;
  const totalPoints = filtered.reduce((sum, c) => sum + (c.points || 0), 0);
  
  let grandTotalSpent = 0;
  filtered.forEach(cli => {
    const clientSales = state.sales.filter(s => s.clientId === cli.id);
    grandTotalSpent += clientSales.reduce((sum, s) => sum + s.total, 0);
  });

  const container = document.getElementById('print-report-template');
  container.innerHTML = `
    <div class="corporate-report-header">
      <div class="corporate-report-brand">
        <h1>Punto 41</h1>
        <span>coffeelab</span>
      </div>
      <div class="corporate-report-title-section">
        <h2>Registro y Directorio de Clientes</h2>
        <p>Generado el: ${new Date().toLocaleDateString('es-CL')} ${new Date().toLocaleTimeString('es-CL')}</p>
      </div>
    </div>

    <div class="corporate-report-summary-grid">
      <div class="corporate-report-summary-card" style="grid-column: span 2;">
        <h4>Clientes Registrados</h4>
        <p>${totalClients}</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Total Puntos Acumulados</h4>
        <p>$${totalPoints.toLocaleString('es-CL')} pts</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Total Recaudado de Clientes</h4>
        <p>${formatCurrency(grandTotalSpent)}</p>
      </div>
    </div>

    <table class="corporate-report-table">
      <thead>
        <tr>
          <th>Nombre</th>
          <th>RUT</th>
          <th>Teléfono</th>
          <th>Correo Electrónico</th>
          <th style="text-align: center;">Compras</th>
          <th style="text-align: right;">Puntos de Fidelidad</th>
          <th style="text-align: right;">Total Gastado</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.length === 0 ? `<tr><td colspan="7" style="text-align: center;">No hay clientes registrados.</td></tr>` : 
          filtered.map(cli => {
            const clientSales = state.sales.filter(s => s.clientId === cli.id);
            const purchasesCount = clientSales.length;
            const totalSpent = clientSales.reduce((sum, s) => sum + s.total, 0);
            return `
              <tr>
                <td><strong>${cli.name}</strong></td>
                <td>${cli.rut}</td>
                <td>${cli.phone || 'N/A'}</td>
                <td>${cli.email || 'N/A'}</td>
                <td style="text-align: center;">${purchasesCount}</td>
                <td style="text-align: right; color: var(--success); font-weight: bold;">$${(cli.points || 0).toLocaleString('es-CL')} pts</td>
                <td style="text-align: right;"><strong>${formatCurrency(totalSpent)}</strong></td>
              </tr>
            `;
          }).join('')
        }
      </tbody>
    </table>

    <div class="corporate-report-footer">
      <p>coffeelab - Sistema de Gestión y POS. Copyright © ${new Date().getFullYear()} Punto 41.</p>
    </div>
  `;

  triggerPDFPrint();
}
window.exportClientsPDF = exportClientsPDF;

function exportDatabasePDF() {
  const totalProducts = state.products.length;
  const totalStock = state.products.reduce((sum, p) => sum + Number(p.stock), 0);
  const totalCostVal = state.products.reduce((sum, p) => sum + (Number(p.costPrice) * Number(p.stock)), 0);
  const totalRetailVal = state.products.reduce((sum, p) => sum + (Number(p.salePrice) * Number(p.stock)), 0);

  const totalClients = state.clients.length;
  const totalPoints = state.clients.reduce((sum, c) => sum + (c.points || 0), 0);

  const totalSuppliers = state.suppliers.length;

  const totalSales = state.sales.length;
  const totalRevenue = state.sales.reduce((sum, s) => sum + s.total, 0);

  const totalProfit = state.sales.reduce((sum, s) => {
    if (s.profit !== undefined) return sum + s.profit;
    const cost = s.items.reduce((acc, item) => {
      const prod = state.products.find(p => p.id === item.productId);
      const c = prod ? Number(prod.costPrice) : 0;
      return acc + (c * item.quantity);
    }, 0);
    return sum + (s.total - cost);
  }, 0);

  const container = document.getElementById('print-report-template');
  container.innerHTML = `
    <div class="corporate-report-header">
      <div class="corporate-report-brand">
        <h1>Punto 41</h1>
        <span>coffeelab</span>
      </div>
      <div class="corporate-report-title-section">
        <h2>Reporte Maestro de la Base de Datos</h2>
        <p>Generado el: ${new Date().toLocaleDateString('es-CL')} ${new Date().toLocaleTimeString('es-CL')}</p>
      </div>
    </div>

    <!-- 1. RESUMEN EJECUTIVO -->
    <h3 style="margin-top: 0; color: #1d4ed8; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; page-break-after: avoid;"><i class="fa-solid fa-list-check"></i> 1. Resumen Ejecutivo del Negocio</h3>
    <div class="corporate-report-summary-grid" style="margin-bottom: 25px;">
      <div class="corporate-report-summary-card">
        <h4>Ventas Registradas</h4>
        <p>${totalSales}</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Total Recaudado</h4>
        <p>${formatCurrency(totalRevenue)}</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Ganancia Neta</h4>
        <p style="color: #16a34a; font-weight: 700;">${formatCurrency(totalProfit)}</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Productos en Catálogo</h4>
        <p>${totalProducts} (${totalStock} uds)</p>
      </div>
      <div class="corporate-report-summary-card">
        <h4>Proveedores Activos</h4>
        <p>${totalSuppliers}</p>
      </div>
    </div>

    <!-- 2. INVENTARIO COMPLETO -->
    <div style="page-break-before: always;">
      <div class="corporate-report-header">
        <div class="corporate-report-brand">
          <h1>Punto 41</h1>
          <span>coffeelab</span>
        </div>
        <div class="corporate-report-title-section">
          <h2>Reporte Maestro de la Base de Datos</h2>
          <p>Sección: Catálogo de Productos</p>
        </div>
      </div>
      <h3 style="color: #1d4ed8; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 0; page-break-after: avoid;"><i class="fa-solid fa-boxes-stacked"></i> 2. Catálogo de Inventario</h3>
      <table class="corporate-report-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Producto</th>
            <th>Categoría</th>
            <th style="text-align: right;">Costo</th>
            <th style="text-align: right;">Venta</th>
            <th style="text-align: center;">Stock</th>
          </tr>
        </thead>
        <tbody>
          ${state.products.length === 0 ? `<tr><td colspan="6" style="text-align: center;">No hay productos registrados.</td></tr>` : 
            state.products.map(p => `
              <tr>
                <td><strong>${p.sku}</strong></td>
                <td>${p.name}</td>
                <td>${p.category}</td>
                <td style="text-align: right;">${formatCurrency(p.costPrice)}</td>
                <td style="text-align: right;"><strong>${formatCurrency(p.salePrice)}</strong></td>
                <td style="text-align: center;">${p.stock}</td>
              </tr>
            `).join('')
          }
        </tbody>
      </table>
    </div>

    <!-- 3. DIRECTORIO DE CLIENTES -->
    <div style="page-break-before: always;">
      <div class="corporate-report-header">
        <div class="corporate-report-brand">
          <h1>Punto 41</h1>
          <span>coffeelab</span>
        </div>
        <div class="corporate-report-title-section">
          <h2>Reporte Maestro de la Base de Datos</h2>
          <p>Sección: Directorio de Clientes</p>
        </div>
      </div>
      <h3 style="color: #1d4ed8; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 0; page-break-after: avoid;"><i class="fa-solid fa-users"></i> 3. Registro de Clientes</h3>
      <table class="corporate-report-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>RUT</th>
            <th>Teléfono</th>
            <th>Correo</th>
            <th style="text-align: right;">Puntos</th>
            <th style="text-align: right;">Total Gastado</th>
          </tr>
        </thead>
        <tbody>
          ${state.clients.length === 0 ? `<tr><td colspan="6" style="text-align: center;">No hay clientes registrados.</td></tr>` : 
            state.clients.map(cli => {
              const clientSales = state.sales.filter(s => s.clientId === cli.id);
              const totalSpent = clientSales.reduce((sum, s) => sum + s.total, 0);
              return `
                <tr>
                  <td><strong>${cli.name}</strong></td>
                  <td>${cli.rut}</td>
                  <td>${cli.phone || 'N/A'}</td>
                  <td>${cli.email || 'N/A'}</td>
                  <td style="text-align: right; color: var(--success); font-weight: bold;">$${(cli.points || 0).toLocaleString('es-CL')} pts</td>
                  <td style="text-align: right;"><strong>${formatCurrency(totalSpent)}</strong></td>
                </tr>
              `;
            }).join('')
          }
        </tbody>
      </table>
    </div>

    <!-- 4. DIRECTORIO DE PROVEEDORES -->
    <div style="page-break-before: always;">
      <div class="corporate-report-header">
        <div class="corporate-report-brand">
          <h1>Punto 41</h1>
          <span>coffeelab</span>
        </div>
        <div class="corporate-report-title-section">
          <h2>Reporte Maestro de la Base de Datos</h2>
          <p>Sección: Directorio de Proveedores</p>
        </div>
      </div>
      <h3 style="color: #1d4ed8; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 0; page-break-after: avoid;"><i class="fa-solid fa-truck-field"></i> 4. Registro de Proveedores</h3>
      <table class="corporate-report-table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>RUT</th>
            <th>Teléfono</th>
            <th>Correo</th>
            <th>Dirección</th>
          </tr>
        </thead>
        <tbody>
          ${state.suppliers.length === 0 ? `<tr><td colspan="5" style="text-align: center;">No hay proveedores registrados.</td></tr>` : 
            state.suppliers.map(sup => `
              <tr>
                <td><strong>${sup.name}</strong></td>
                <td>${sup.rut}</td>
                <td>${sup.phone}</td>
                <td>${sup.email}</td>
                <td>${sup.address}</td>
              </tr>
            `).join('')
          }
        </tbody>
      </table>
    </div>

    <!-- 5. HISTORIAL COMPLETO DE VENTAS -->
    <div style="page-break-before: always;">
      <div class="corporate-report-header">
        <div class="corporate-report-brand">
          <h1>Punto 41</h1>
          <span>coffeelab</span>
        </div>
        <div class="corporate-report-title-section">
          <h2>Reporte Maestro de la Base de Datos</h2>
          <p>Sección: Historial de Ventas</p>
        </div>
      </div>
      <h3 style="color: #1d4ed8; font-size: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 0; page-break-after: avoid;"><i class="fa-solid fa-receipt"></i> 5. Historial General de Ventas</h3>
      <table class="corporate-report-table">
        <thead>
          <tr>
            <th>Fecha y Hora</th>
            <th>ID Venta</th>
            <th>Cliente</th>
            <th>Medio de Pago</th>
            <th style="text-align: right;">Neto</th>
            <th style="text-align: right;">IVA (19%)</th>
            <th style="text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${state.sales.length === 0 ? `<tr><td colspan="7" style="text-align: center;">No hay ventas registradas.</td></tr>` : 
            state.sales.map(s => {
              const sDate = new Date(s.date);
              const cli = state.clients.find(c => c.id === s.clientId);
              const clientName = cli ? cli.name : 'Cliente Anónimo';
              const netoVal = s.neto || Math.round(s.total / 1.19);
              const ivaVal = s.iva || (s.total - netoVal);
              return `
                <tr>
                  <td>${sDate.toLocaleDateString('es-CL')} ${sDate.toLocaleTimeString('es-CL', {hour: '2-digit', minute: '2-digit'})}</td>
                  <td><strong>${s.id}</strong></td>
                  <td>${clientName}</td>
                  <td>${capitalize(s.paymentMethod)}</td>
                  <td style="text-align: right;">${formatCurrency(netoVal)}</td>
                  <td style="text-align: right; color: #475569;">${formatCurrency(ivaVal)}</td>
                  <td style="text-align: right;"><strong>${formatCurrency(s.total)}</strong></td>
                </tr>
              `;
            }).join('')
          }
        </tbody>
      </table>
    </div>

    <div class="corporate-report-footer" style="page-break-before: avoid;">
      <p>coffeelab - Sistema de Gestión y POS. Copyright © ${new Date().getFullYear()} Punto 41.</p>
    </div>
  `;

  triggerPDFPrint();
}
window.exportDatabasePDF = exportDatabasePDF;

function triggerPDFPrint() {
  document.body.classList.add('printing-report');
  setTimeout(() => {
    window.print();
    setTimeout(() => {
      document.body.classList.remove('printing-report');
    }, 500);
  }, 250);
}

// --- CENTRO DE ALERTAS Y NOTIFICACIONES DE STOCK BAJO ---
function updateNotifications() {
  const lowStockProducts = state.products.filter(p => Number(p.stock) <= Number(p.minStock));
  const badge = document.getElementById('notifications-badge');
  const headerCount = document.getElementById('notifications-header-count');
  const listContainer = document.getElementById('notifications-list');

  if (!listContainer) return;

  if (lowStockProducts.length > 0) {
    if (badge) {
      badge.innerText = lowStockProducts.length;
      badge.style.display = 'flex';
    }
    if (headerCount) {
      headerCount.innerText = `${lowStockProducts.length} ${lowStockProducts.length === 1 ? 'alerta' : 'alertas'}`;
      headerCount.className = 'badge badge-danger';
    }

    listContainer.innerHTML = lowStockProducts.map(prod => {
      return `
        <div class="notification-item" style="padding: 12px 15px; display: flex; flex-direction: column; gap: 8px; transition: background-color 0.2s;">
          <div style="display: flex; align-items: flex-start; gap: 10px;">
            <div style="background-color: rgba(239, 68, 68, 0.1); color: var(--danger); border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <i class="fa-solid fa-triangle-exclamation" style="font-size: 14px;"></i>
            </div>
            <div style="flex: 1;">
              <h5 style="margin: 0 0 2px 0; font-size: 13px; font-weight: 600; color: var(--text-main);">${prod.name}</h5>
              <p style="margin: 0; font-size: 11px; color: var(--danger); font-weight: 500;">Quedan solo ${prod.stock} uds (Mín: ${prod.minStock})</p>
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-left: 38px;">
            <button class="btn btn-secondary btn-xs" onclick="goToInventoryAndSearch(event, '${prod.name}')" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px;">
              <i class="fa-solid fa-magnifying-glass"></i> Ver Producto
            </button>
            <button class="btn btn-primary btn-xs" onclick="contactSupplierModal(event, '${prod.supplierId}', '${prod.name}')" style="padding: 4px 8px; font-size: 11px; display: flex; align-items: center; gap: 4px; background-color: var(--primary);">
              <i class="fa-solid fa-envelope"></i> Contactar
            </button>
          </div>
        </div>
      `;
    }).join('');
  } else {
    if (badge) {
      badge.style.display = 'none';
    }
    if (headerCount) {
      headerCount.innerText = '0 alertas';
      headerCount.className = 'badge badge-neutral';
    }
    listContainer.innerHTML = `
      <div class="no-notifications-state" style="padding: 30px 15px; text-align: center; color: var(--text-muted);">
        <i class="fa-solid fa-circle-check" style="font-size: 24px; color: var(--success); margin-bottom: 8px; display: block; text-align: center; margin-left: auto; margin-right: auto;"></i>
        Sin alertas de stock bajo
      </div>
    `;
  }
}
window.updateNotifications = updateNotifications;

function goToInventoryAndSearch(e, productName) {
  if (e) e.stopPropagation();
  
  // Cerrar dropdown
  const dropdown = document.getElementById('notifications-dropdown');
  if (dropdown) dropdown.classList.remove('active');
  
  navigateTo('inventory');
  
  const searchInput = document.getElementById('inventory-search');
  if (searchInput) {
    searchInput.value = productName;
  }
  renderInventory(productName);
}
window.goToInventoryAndSearch = goToInventoryAndSearch;

function contactSupplierModal(e, supplierId, productName) {
  if (e) e.stopPropagation();
  
  // Cerrar dropdown de notificaciones
  const dropdown = document.getElementById('notifications-dropdown');
  if (dropdown) dropdown.classList.remove('active');
  
  const sup = state.suppliers.find(s => s.id === supplierId);
  if (!sup) {
    showToast('No se encontró proveedor asignado a este producto', 'warning');
    return;
  }

  document.getElementById('contact-supplier-name').innerText = sup.name;
  document.getElementById('contact-supplier-rut').innerText = `RUT: ${sup.rut}`;
  
  const phoneLink = document.getElementById('contact-supplier-phone-link');
  phoneLink.innerText = sup.phone || 'No registrado';
  phoneLink.href = sup.phone ? `tel:${sup.phone.replace(/\s+/g, '')}` : '#';
  
  const emailLink = document.getElementById('contact-supplier-email-link');
  emailLink.innerText = sup.email || 'No registrado';
  emailLink.href = sup.email ? `mailto:${sup.email}?subject=Pedido de Reabastecimiento - ${encodeURIComponent(productName)}&body=Estimado ${encodeURIComponent(sup.name)},%0D%0A%0D%0ANecesitamos solicitar reabastecimiento del producto: ${encodeURIComponent(productName)}.%0D%0A%0D%0AQuedamos atentos.%0D%0ASaludos cordiales.` : '#';

  // Botones de acción directa
  const callBtn = document.getElementById('contact-supplier-call-btn');
  callBtn.href = sup.phone ? `tel:${sup.phone.replace(/\s+/g, '')}` : '#';
  if (!sup.phone) callBtn.style.opacity = '0.5';
  else callBtn.style.opacity = '1';

  const mailBtn = document.getElementById('contact-supplier-mail-btn');
  mailBtn.href = emailLink.href;
  if (!sup.email) mailBtn.style.opacity = '0.5';
  else mailBtn.style.opacity = '1';

  document.getElementById('contact-supplier-modal').classList.add('active');
}
window.contactSupplierModal = contactSupplierModal;

function updateCashChange() {
  const cashInput = document.getElementById('pos-cash-received');
  const changeValue = document.getElementById('pos-cash-change');
  const totalBtnText = document.getElementById('btn-checkout-total').innerText;
  
  if (!cashInput || !changeValue) return;

  const totalVal = parseInt(totalBtnText.replace(/[^0-9]/g, '')) || 0;
  const cashVal = parseFloat(cashInput.value) || 0;

  const selectedPayment = document.querySelector('input[name="payment-method"]:checked');
  if (!selectedPayment || selectedPayment.value !== 'efectivo') {
    changeValue.innerText = '$0';
    changeValue.style.color = 'var(--text-muted)';
    return;
  }

  if (cashVal >= totalVal && totalVal > 0) {
    const change = cashVal - totalVal;
    changeValue.innerText = formatCurrency(change);
    changeValue.style.color = 'var(--success)';
  } else {
    changeValue.innerText = '$0';
    changeValue.style.color = 'var(--text-muted)';
  }
}
window.updateCashChange = updateCashChange;

// --- SISTEMA DE PIN/CLAVE PERSONALIZADO PARA ADMINISTRADOR ---
function pressPasscodeKey(key) {
  const input = document.getElementById('passcode-input');
  if (input && input.value.length < 4) {
    input.value += key;
  }
}
window.pressPasscodeKey = pressPasscodeKey;

function backspacePasscode() {
  const input = document.getElementById('passcode-input');
  if (input && input.value.length > 0) {
    input.value = input.value.slice(0, -1);
  }
}
window.backspacePasscode = backspacePasscode;

function clearPasscode() {
  const input = document.getElementById('passcode-input');
  if (input) {
    input.value = '';
  }
}
window.clearPasscode = clearPasscode;

function cancelPasscode() {
  closeModal('passcode-modal');
  document.getElementById('app-role-select').value = activeRole;
  applyRoleRestrictions();
}
window.cancelPasscode = cancelPasscode;

function verifyPasscode() {
  const input = document.getElementById('passcode-input');
  const modalContent = document.getElementById('passcode-modal-content');
  if (!input || !modalContent) return;

  if (input.value === '6707') {
    activeRole = 'admin';
    closeModal('passcode-modal');
    applyRoleRestrictions();
    showToast('Acceso concedido como Administrador', 'success');
  } else {
    showToast('Código PIN incorrecto', 'danger');
    clearPasscode();
    
    // Animación de sacudida (shake)
    modalContent.classList.add('shake');
    setTimeout(() => {
      modalContent.classList.remove('shake');
    }, 350);
  }
}
window.verifyPasscode = verifyPasscode;

// Soporte teclado físico para el modal de clave
document.addEventListener('keydown', (e) => {
  const modal = document.getElementById('passcode-modal');
  if (modal && modal.classList.contains('active')) {
    if (e.key >= '0' && e.key <= '9') {
      pressPasscodeKey(e.key);
    } else if (e.key === 'Backspace') {
      backspacePasscode();
    } else if (e.key === 'Enter') {
      verifyPasscode();
    } else if (e.key === 'Escape') {
      cancelPasscode();
    }
  }
});

// --- SISTEMA DE AUTOCUMPLETADO / BÚSQUEDA DE CLIENTES EN POS ---
function syncPOSClientSearch() {
  const select = document.getElementById('pos-client-select');
  const searchInput = document.getElementById('pos-client-search');
  const clearBtn = document.getElementById('pos-client-clear-btn');
  
  if (!select || !searchInput) return;

  const clientId = select.value;
  if (clientId) {
    const client = state.clients.find(c => c.id === clientId);
    if (client) {
      searchInput.value = `${client.name} (${client.rut})`;
      if (clearBtn) clearBtn.style.display = 'block';
      return;
    }
  }

  searchInput.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
}
window.syncPOSClientSearch = syncPOSClientSearch;

function filterPOSClients(query) {
  const resultsContainer = document.getElementById('pos-client-results');
  if (!resultsContainer) return;

  const normalizedQuery = getNormalizedText(query);
  
  if (!normalizedQuery) {
    // Si está vacío, mostrar todos los clientes para selección rápida
    renderPOSClientResults(state.clients);
    return;
  }

  const filtered = state.clients.filter(cli => {
    return getNormalizedText(cli.name).includes(normalizedQuery) ||
           getNormalizedText(cli.rut).includes(normalizedQuery);
  });

  renderPOSClientResults(filtered);
}
window.filterPOSClients = filterPOSClients;

function renderPOSClientResults(clientsList) {
  const resultsContainer = document.getElementById('pos-client-results');
  if (!resultsContainer) return;

  if (clientsList.length === 0) {
    resultsContainer.innerHTML = `
      <div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 12px;">
        No hay coincidencias.
        <a href="#" onclick="openClientModal(); document.getElementById('pos-client-results').style.display='none'; return false;" style="color: var(--primary); font-weight: 600; text-decoration: underline; display: block; margin-top: 6px;">+ Registrar nuevo cliente</a>
      </div>
    `;
    resultsContainer.style.display = 'block';
    return;
  }

  resultsContainer.innerHTML = clientsList.map(cli => {
    return `
      <div class="client-search-result-item" onclick="selectPOSClient('${cli.id}')" style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--border-color); font-size: 13px; background-color: #ffffff; transition: background-color 0.15s;">
        <strong style="color: var(--text-main); display: block;">${cli.name}</strong>
        <span style="font-size: 11px; color: var(--text-muted); display: block; margin-top: 2px;">RUT: ${cli.rut} | Puntos: $${(cli.points || 0).toLocaleString('es-CL')}</span>
      </div>
    `;
  }).join('');

  // Estilo hover dinámico
  const items = resultsContainer.querySelectorAll('.client-search-result-item');
  items.forEach(item => {
    item.addEventListener('mouseenter', () => {
      item.style.backgroundColor = 'var(--bg-app)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.backgroundColor = '#ffffff';
    });
  });

  resultsContainer.style.display = 'block';
}

function selectPOSClient(clientId) {
  const select = document.getElementById('pos-client-select');
  if (select) {
    select.value = clientId;
    // Disparar evento change nativo
    const event = new Event('change');
    select.dispatchEvent(event);
  }
  
  const resultsContainer = document.getElementById('pos-client-results');
  if (resultsContainer) resultsContainer.style.display = 'none';
}
window.selectPOSClient = selectPOSClient;

// --- INTEGRACIÓN NUBE E-BOLETA SII ---
function updateSIIStatusUI(text, statusType) {
  const statusEl = document.getElementById('settings-sii-status');
  if (!statusEl) return;

  if (statusType === 'connected') {
    statusEl.innerHTML = `<i class="fa-solid fa-circle" style="font-size: 8px; margin-right: 4px; color: var(--success); vertical-align: middle;"></i> Conectado`;
    statusEl.style.color = 'var(--success)';
  } else if (statusType === 'loading') {
    statusEl.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="font-size: 10px; margin-right: 4px; vertical-align: middle;"></i> Conectando...`;
    statusEl.style.color = 'var(--warning)';
  } else if (statusType === 'captcha') {
    statusEl.innerHTML = `<i class="fa-solid fa-circle-exclamation" style="font-size: 8px; margin-right: 4px; color: var(--warning); vertical-align: middle;"></i> Validar CAPTCHA`;
    statusEl.style.color = 'var(--warning)';
  } else {
    statusEl.innerHTML = `<i class="fa-solid fa-circle" style="font-size: 8px; margin-right: 4px; color: var(--danger); vertical-align: middle;"></i> Desconectado`;
    statusEl.style.color = 'var(--danger)';
  }
}

function checkSIIConnectionStatus() {
  if (window.location.protocol === 'file:') return;
  fetch('/api/sii/status')
    .then(res => res.json())
    .then(data => {
      if (data.connected) {
        updateSIIStatusUI(null, 'connected');
      } else {
        updateSIIStatusUI(null, 'disconnected');
      }
    })
    .catch(() => {
      updateSIIStatusUI(null, 'disconnected');
    });
}
window.checkSIIConnectionStatus = checkSIIConnectionStatus;

function connectSII() {
  if (window.location.protocol === 'file:') {
    updateSIIStatusUI(null, 'disconnected');
    showToast('Error: Estás abriendo el archivo HTML local directamente. Debes iniciar el servidor de Node.js o desplegarlo en Render para usar la integración.', 'danger');
    return;
  }

  const rut = document.getElementById('settings-sii-rut')?.value;
  const clave = document.getElementById('settings-sii-clave')?.value;

  if (!rut || !clave) {
    showToast('Por favor ingrese el RUT y la clave tributaria del SII', 'warning');
    return;
  }

  updateSIIStatusUI(null, 'loading');
  showToast('Iniciando sesión en la nube del SII...', 'info');

  fetch('/api/sii/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rut, clave })
  })
  .then(res => {
    if (!res.ok) {
      return res.text().then(text => { throw new Error(text || `Error HTTP ${res.status}`); });
    }
    return res.json();
  })
  .then(data => {
    if (data.success) {
      if (data.status === 'captcha_required') {
        updateSIIStatusUI(null, 'captcha');
        openCaptchaModal(data.captchaImg);
      } else if (data.status === 'connected') {
        updateSIIStatusUI(null, 'connected');
        showToast('Conectado con éxito al portal de e-boleta SII', 'success');
      }
    } else {
      updateSIIStatusUI(null, 'disconnected');
      showToast('Error SII: ' + data.message, 'danger');
    }
  })
  .catch(err => {
    updateSIIStatusUI(null, 'disconnected');
    showToast('Error de red al intentar conectar con el SII', 'danger');
  });
}
window.connectSII = connectSII;

function openCaptchaModal(imgSrc) {
  const imgEl = document.getElementById('sii-captcha-img');
  const inputEl = document.getElementById('sii-captcha-input');
  if (imgEl) imgEl.src = imgSrc;
  if (inputEl) inputEl.value = '';
  document.getElementById('sii-captcha-modal').classList.add('active');
  setTimeout(() => { if (inputEl) inputEl.focus(); }, 300);
}

function submitSIICaptcha() {
  const captchaText = document.getElementById('sii-captcha-input')?.value;

  if (!captchaText) {
    showToast('Por favor escribe el texto del CAPTCHA', 'warning');
    return;
  }

  showToast('Enviando código de seguridad...', 'info');
  closeModal('sii-captcha-modal');
  updateSIIStatusUI(null, 'loading');

  fetch('/api/sii/solve-captcha', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ captchaText })
  })
  .then(res => {
    if (!res.ok) {
      return res.text().then(text => { throw new Error(text || `Error HTTP ${res.status}`); });
    }
    return res.json();
  })
  .then(data => {
    if (data.success) {
      updateSIIStatusUI(null, 'connected');
      showToast('Conectado con éxito al portal de e-boleta SII', 'success');
    } else if (data.status === 'captcha_required') {
      updateSIIStatusUI(null, 'captcha');
      showToast('Código incorrecto. Reintentando...', 'warning');
      openCaptchaModal(data.captchaImg);
    } else {
      updateSIIStatusUI(null, 'disconnected');
      showToast('Error: ' + data.message, 'danger');
    }
  })
  .catch(err => {
    updateSIIStatusUI(null, 'disconnected');
    showToast('Error de red al enviar CAPTCHA', 'danger');
  });
}
window.submitSIICaptcha = submitSIICaptcha;

// --- SINCRONIZACIÓN CON SUPABASE CLOUD ---
async function loadStateFromSupabase() {
  if (!supabaseClient) return;
  
  try {
    showToast('Sincronizando base de datos en la nube...', 'info');

    // Cargar tablas en paralelo
    const [resProd, resCli, resSup, resSal] = await Promise.all([
      supabaseClient.from('products').select('*'),
      supabaseClient.from('clients').select('*'),
      supabaseClient.from('suppliers').select('*'),
      supabaseClient.from('sales').select('*')
    ]);

    if (resProd.error) throw resProd.error;
    if (resCli.error) throw resCli.error;
    if (resSup.error) throw resSup.error;
    if (resSal.error) throw resSal.error;

    // Actualizar estado local
    state.products = resProd.data || [];
    state.clients = resCli.data || [];
    state.suppliers = resSup.data || [];
    // Ordenar ventas por fecha descendente
    state.sales = (resSal.data || []).sort((a, b) => new Date(b.date) - new Date(a.date));

    // Si todo está vacío (y no hay registros en localstorage), sembramos datos de demostración y los subimos
    if (state.products.length === 0 && state.suppliers.length === 0) {
      const wasCleared = localStorage.getItem('p41_cleared');
      if (!wasCleared) {
        console.log('Base de datos vacía en la nube. Sembrando datos...');
        seedData();
        await syncStateToSupabase();
      }
    } else {
      // Guardar copia local de respaldo
      localStorage.setItem('p41_products', JSON.stringify(state.products));
      localStorage.setItem('p41_clients', JSON.stringify(state.clients));
      localStorage.setItem('p41_suppliers', JSON.stringify(state.suppliers));
      localStorage.setItem('p41_sales', JSON.stringify(state.sales));
      
      showToast('Sincronización en la nube completada con éxito', 'success');
      renderAllViews();
    }
  } catch (error) {
    console.error('Error al sincronizar con Supabase:', error);
    showToast('Error de red. Usando base de datos local (Offline)', 'warning');
    loadStateFromLocalStorage();
    renderAllViews();
  }
}
window.loadStateFromSupabase = loadStateFromSupabase;

async function syncStateToSupabase() {
  if (!supabaseClient) return;
  
  try {
    // Sincronizar productos
    if (state.products.length > 0) {
      const { error } = await supabaseClient.from('products').upsert(state.products);
      if (error) throw error;
    }
    // Sincronizar clientes
    if (state.clients.length > 0) {
      const { error } = await supabaseClient.from('clients').upsert(state.clients);
      if (error) throw error;
    }
    // Sincronizar proveedores
    if (state.suppliers.length > 0) {
      const { error } = await supabaseClient.from('suppliers').upsert(state.suppliers);
      if (error) throw error;
    }
    // Sincronizar ventas
    if (state.sales.length > 0) {
      const { error } = await supabaseClient.from('sales').upsert(state.sales);
      if (error) throw error;
    }
    console.log('Datos guardados y sincronizados con éxito en Supabase.');
  } catch (error) {
    console.error('Error al subir datos a Supabase:', error);
  }
}
window.syncStateToSupabase = syncStateToSupabase;

function renderAllViews() {
  if (selectedView === 'pos') renderPOS();
  else if (selectedView === 'inventory') renderInventory();
  else if (selectedView === 'clients') renderClients();
  else if (selectedView === 'suppliers') renderSuppliers();
  else if (selectedView === 'reports') renderReports();
  else navigateTo(selectedView);
}
window.renderAllViews = renderAllViews;


// ==========================================
// --- MÓDULO DE IMPORTACIÓN DESDE PDF ---
// ==========================================

// Abrir modal de importación
document.getElementById('btn-import-pdf')?.addEventListener('click', () => {
  openModal('import-pdf-modal');
  resetPDFImportUI();
});

function resetPDFImportUI() {
  document.getElementById('pdf-upload-step').style.display = 'block';
  document.getElementById('pdf-preview-step').style.display = 'none';
  document.getElementById('btn-confirm-pdf-import').style.display = 'none';
  document.getElementById('btn-confirm-pdf-import').disabled = true;
  document.getElementById('pdf-file-input').value = '';
  document.getElementById('pdf-items-tbody').innerHTML = '';
}

// Configurar Drag & Drop en el dropzone
const dropzone = document.getElementById('pdf-dropzone');
const fileInput = document.getElementById('pdf-file-input');

dropzone?.addEventListener('click', () => fileInput.click());

dropzone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});

dropzone?.addEventListener('dragleave', () => {
  dropzone.classList.remove('dragover');
});

dropzone?.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].type === 'application/pdf') {
    processPDFFile(files[0]);
  } else {
    showToast('Por favor cargue un archivo PDF válido', 'danger');
  }
});

fileInput?.addEventListener('change', (e) => {
  const files = e.target.files;
  if (files.length > 0) {
    processPDFFile(files[0]);
  }
});

// Cambiar archivo
document.getElementById('btn-pdf-reset')?.addEventListener('click', () => {
  resetPDFImportUI();
});

// Procesar lectura del PDF
function processPDFFile(file) {
  showToast('Leyendo archivo PDF...', 'info');
  const reader = new FileReader();
  
  reader.onload = async function() {
    try {
      const arrayBuffer = this.result;
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let allTextItems = [];

      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        const items = textContent.items.map(item => ({
          text: item.str.trim(),
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: item.height
        }));
        allTextItems = allTextItems.concat(items);
      }

      // Intentar primero la extracción estructurada exacta de reportes de Punto 41
      let parsedProducts = parsePunto41Report(allTextItems);
      
      if (!parsedProducts || parsedProducts.length === 0) {
        // Fallback al parseador genérico por filas horizontales
        const rows = groupTextItemsIntoRows(allTextItems);
        parsedProducts = parseRowsToProducts(rows);
      }

      if (parsedProducts.length === 0) {
        showToast('No se detectaron productos en el PDF. Verifique el formato.', 'warning');
        return;
      }

      renderPDFPreviewTable(parsedProducts);
    } catch (err) {
      console.error('Error al parsear PDF:', err);
      showToast('Error al leer el archivo PDF', 'danger');
    }
  };

  reader.readAsArrayBuffer(file);
}

// Extractor especializado por coordenadas para reportes del POS (Punto 41)
function parsePunto41Report(items) {
  // Buscar cabeceras para calibrar automáticamente las coordenadas horizontales (X)
  const skuItem = items.find(item => item.text.replace(/\s/g, "").toLowerCase() === "sku");
  const prodItem = items.find(item => item.text.replace(/\s/g, "").toLowerCase() === "producto");
  const catItem = items.find(item => {
    const t = item.text.replace(/\s/g, "").toLowerCase();
    return t === "categoría" || t === "categoria";
  });
  const costItem = items.find(item => item.text.replace(/\s/g, "").toLowerCase() === "costo");
  const saleItem = items.find(item => item.text.replace(/\s/g, "").toLowerCase() === "venta");
  const stockItem = items.find(item => item.text.replace(/\s/g, "").toLowerCase() === "stock");

  // Coordenadas límite de división por defecto
  let mid0_1 = 120;
  let mid1_2 = 240;
  let mid2_3 = 340;
  let mid3_4 = 430;
  let mid4_5 = 510;

  // Calibrar dinámicamente si se encuentran las cabeceras (resiste cualquier margen de impresión o tamaño A4/Carta)
  if (skuItem && prodItem && catItem && costItem && saleItem && stockItem) {
    mid0_1 = (skuItem.x + prodItem.x) / 2;
    mid1_2 = (prodItem.x + catItem.x) / 2;
    mid2_3 = (catItem.x + costItem.x) / 2;
    mid3_4 = (costItem.x + saleItem.x) / 2;
    mid4_5 = (saleItem.x + stockItem.x) / 2;
  }

  // Buscar elementos que actúan como inicio de fila de producto en la columna SKU (X < mid0_1)
  const skuStarts = items.filter(item => {
    const text = item.text.replace(/\s/g, "");
    const lowerText = text.toLowerCase();
    
    // Ignorar si coincide con las cabeceras
    if (lowerText === "sku" || lowerText === "producto" || lowerText === "categoría" || lowerText === "categoria" || lowerText === "costo" || lowerText === "venta" || lowerText === "stock") {
      return false;
    }
    
    return item.x < mid0_1 && (
      text.includes("P41-") || 
      text.includes("P41\u002d") || 
      /^P41\-\d+/.test(text) || 
      /^[a-zA-Z0-9]+\-\d+/.test(text)
    );
  });

  if (skuStarts.length === 0) {
    skuStarts.push(...items.filter(item => {
      const text = item.text.trim();
      if (text.toLowerCase() === "sku" || text.length < 2) return false;
      return item.x < mid0_1 && /^[a-zA-Z0-9\-]+$/.test(text);
    }));
  }

  if (skuStarts.length === 0) return null;

  // Ordenar de arriba a abajo por coordenada Y
  skuStarts.sort((a, b) => b.y - a.y);

  // Definir rangos verticales para cada producto
  const rows = skuStarts.map((start, idx) => ({
    startY: start.y,
    endY: idx < skuStarts.length - 1 ? skuStarts[idx + 1].y : -9999,
    cols: [[], [], [], [], [], []] // 6 columnas lógicas
  }));

  // Agrupar el resto de ítems en sus respectivas celdas según coordenadas Y e X
  items.forEach(item => {
    // Ignorar cabeceras muy superiores
    if (item.y > skuStarts[0].y + 15) return;

    // Encontrar fila correspondiente
    const row = rows.find(r => item.y <= r.startY + 8 && item.y > r.endY + 8);
    if (!row) return;

    // Clasificar columna según coordenadas horizontales calibradas
    let colIdx = -1;
    if (item.x < mid0_1) colIdx = 0; // SKU
    else if (item.x >= mid0_1 && item.x < mid1_2) colIdx = 1; // Producto
    else if (item.x >= mid1_2 && item.x < mid2_3) colIdx = 2; // Categoría
    else if (item.x >= mid2_3 && item.x < mid3_4) colIdx = 3; // Costo
    else if (item.x >= mid3_4 && item.x < mid4_5) colIdx = 4; // Venta
    else colIdx = 5; // Stock

    row.cols[colIdx].push(item);
  });

  const products = [];
  rows.forEach(row => {
    // Ordenar elementos internos de cada celda
    row.cols.forEach(col => {
      col.sort((a, b) => {
        if (Math.abs(a.y - b.y) < 3) return a.x - b.x;
        return b.y - a.y;
      });
    });

    // Reconstruir textos de celdas
    const sku = row.cols[0].map(item => item.text).join("").replace(/\s/g, "");
    const name = row.cols[1].map(item => item.text).join(" ").replace(/\s+/g, " ").trim();
    const category = row.cols[2].map(item => item.text).join(" ").replace(/\s+/g, " ").trim();
    const costStr = row.cols[3].map(item => item.text).join("").replace(/[^0-9]/g, "");
    const saleStr = row.cols[4].map(item => item.text).join("").replace(/[^0-9]/g, "");
    const stockStr = row.cols[5].map(item => item.text).join("").replace(/[^0-9\-]/g, "");

    const costPrice = parseInt(costStr, 10) || 0;
    const salePrice = parseInt(saleStr, 10) || 0;
    const stock = parseInt(stockStr, 10) || 0;

    if (name && name.length > 2 && (costPrice > 0 || salePrice > 0)) {
      products.push({
        name,
        sku: sku || 'PDF-' + Math.floor(1000 + Math.random() * 9000),
        category: category || 'Repostería',
        costPrice,
        salePrice,
        quantity: stock
      });
    }
  });

  return products;
}

// Agrupar items de texto por coordenadas horizontales (líneas de filas)
function groupTextItemsIntoRows(items) {
  const activeItems = items.filter(item => item.text.length > 0);
  if (activeItems.length === 0) return [];

  const rows = [];
  activeItems.forEach(item => {
    let foundRow = rows.find(r => Math.abs(r.y - item.y) < 5);
    if (foundRow) {
      foundRow.items.push(item);
    } else {
      rows.push({
        y: item.y,
        items: [item]
      });
    }
  });

  // Ordenar filas de arriba a abajo (mayor Y a menor Y)
  rows.sort((a, b) => b.y - a.y);

  // Ordenar elementos en cada fila de izquierda a derecha (menor X a mayor X)
  rows.forEach(row => {
    row.items.sort((a, b) => a.x - b.x);
  });

  return rows;
}

// Heurística de conversión de filas a productos estructurados
function parseRowsToProducts(rows) {
  const products = [];
  
  rows.forEach(row => {
    const textParts = row.items.map(item => item.text);
    const fullRowText = textParts.join(" ");

    // Saltar cabeceras o filas de totales
    if (
      fullRowText.includes("FACTURA") || 
      fullRowText.includes("RUT:") || 
      fullRowText.includes("TOTAL") || 
      fullRowText.includes("NETO") || 
      fullRowText.includes("IVA") ||
      fullRowText.includes("Subtotal") ||
      fullRowText.includes("Señor") ||
      fullRowText.includes("R.U.T.") ||
      fullRowText.includes("GIRO:")
    ) {
      return;
    }

    // Reconstruir columnas lógicas según espacio horizontal X
    const cols = [];
    let currentCol = null;
    
    row.items.forEach(item => {
      if (!currentCol) {
        currentCol = { text: item.text, minX: item.x, maxX: item.x + item.width };
      } else {
        const distance = item.x - currentCol.maxX;
        if (distance < 20) {
          currentCol.text += " " + item.text;
          currentCol.maxX = Math.max(currentCol.maxX, item.x + item.width);
        } else {
          cols.push(currentCol);
          currentCol = { text: item.text, minX: item.x, maxX: item.x + item.width };
        }
      }
    });
    if (currentCol) cols.push(currentCol);

    const cleanedCols = cols.map(c => ({
      text: c.text.trim(),
      minX: c.minX
    })).filter(c => c.text.length > 0);

    // Mínimo 3 columnas para ser una fila de tabla válida (ej: Cantidad, Detalle, Precio)
    if (cleanedCols.length >= 3) {
      let name = "";
      let quantity = 1;
      let costPrice = 0;
      let sku = "";

      // 1. La columna de descripción suele ser el texto más largo
      let descColIdx = -1;
      let maxLen = 0;
      cleanedCols.forEach((col, idx) => {
        if (col.text.length > maxLen) {
          maxLen = col.text.length;
          descColIdx = idx;
        }
      });

      if (descColIdx === -1) return;
      name = cleanedCols[descColIdx].text;

      // Ignorar si parece solo números
      if (name.length < 3 || /^\d+$/.test(name.replace(/[\s\.\,\-]/g, ""))) {
        return;
      }

      // 2. Analizar el resto de columnas para buscar números (cantidades y precios)
      const otherCols = cleanedCols.filter((_, idx) => idx !== descColIdx);
      const numbers = [];

      otherCols.forEach(col => {
        const cleanNumStr = col.text.replace(/[^0-9]/g, "");
        const val = parseInt(cleanNumStr, 10);
        if (!isNaN(val) && val > 0) {
          numbers.push({
            value: val,
            minX: col.minX
          });
        } else if (col.text.length > 3 && sku === "") {
          sku = col.text; // Usar el texto no numérico largo restante como SKU aproximado
        }
      });

      // El menor es cantidad, el mediano es costo unitario, el mayor es el total de la línea
      if (numbers.length >= 2) {
        numbers.sort((a, b) => a.value - b.value);
        quantity = numbers[0].value;
        costPrice = numbers[1].value;

        if (quantity > 1000 && costPrice > 1000) {
          costPrice = Math.min(quantity, costPrice);
          quantity = 1;
        }
      } else if (numbers.length === 1) {
        costPrice = numbers[0].value;
        quantity = 1;
      }

      if (costPrice === 0) return;

      // Limpiar signos monetarios del nombre
      name = name.replace(/\$\s*\d+[\d\.\,]*$/, "").trim();

      products.push({
        name,
        sku: sku || 'PDF-' + Math.floor(1000 + Math.random() * 9000),
        costPrice,
        quantity
      });
    }
  });

  return products;
}

// Renderizar la tabla de previsualización para confirmación
function renderPDFPreviewTable(products) {
  const tbody = document.getElementById('pdf-items-tbody');
  tbody.innerHTML = '';

  // Obtener categorías únicas del sistema
  const categories = [...new Set(state.products.map(p => p.category))];
  if (categories.length === 0) categories.push('Café', 'Repostería', 'Bebidas');

  products.forEach((prod, index) => {
    // Buscar si el producto ya existe por SKU o por nombre (insensible a mayúsculas)
    const existing = state.products.find(p => p.sku === prod.sku || p.name.toLowerCase() === prod.name.toLowerCase());
    
    const status = existing ? 'update' : 'new';
    const statusBadge = status === 'update' 
      ? '<span class="badge-import-status update">Actualizar</span>' 
      : '<span class="badge-import-status new">Nuevo</span>';

    const finalSku = existing ? existing.sku : prod.sku;
    
    // Si la categoría extraída del PDF no está en la lista del sistema, la agregamos al selector
    if (prod.category && !categories.includes(prod.category)) {
      categories.push(prod.category);
    }

    const finalCategory = existing ? existing.category : (prod.category || categories[0]);
    const finalSalePrice = existing ? existing.salePrice : (prod.salePrice || Math.round(prod.costPrice * 1.5));

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="text-align: center;">
        <input type="checkbox" class="pdf-row-select" data-index="${index}" checked>
      </td>
      <td>
        <input type="text" class="pdf-row-sku pdf-row-select" value="${finalSku}" data-index="${index}">
      </td>
      <td>
        <input type="text" class="pdf-row-name pdf-row-select" style="width: 100%;" value="${prod.name}" data-index="${index}">
      </td>
      <td>
        <select class="pdf-row-category pdf-row-select" data-index="${index}">
          ${categories.map(cat => `<option value="${cat}" ${cat === finalCategory ? 'selected' : ''}>${cat}</option>`).join('')}
        </select>
      </td>
      <td style="text-align: right;">
        <input type="number" class="pdf-row-price pdf-row-cost" value="${prod.costPrice}" data-index="${index}">
      </td>
      <td style="text-align: right;">
        <input type="number" class="pdf-row-price pdf-row-sale" value="${finalSalePrice}" data-index="${index}">
      </td>
      <td style="text-align: center;">
        <input type="number" class="pdf-row-price pdf-row-qty" style="width: 50px; text-align: center;" value="${prod.quantity}" data-index="${index}">
      </td>
      <td style="text-align: center;">
        ${statusBadge}
      </td>
    `;
    tbody.appendChild(row);
  });

  document.getElementById('pdf-detected-count').innerText = products.length;
  document.getElementById('pdf-upload-step').style.display = 'none';
  document.getElementById('pdf-preview-step').style.display = 'block';
  document.getElementById('btn-confirm-pdf-import').style.display = 'inline-block';
  document.getElementById('btn-confirm-pdf-import').disabled = false;
}

// Ejecutar importación al inventario
document.getElementById('btn-confirm-pdf-import')?.addEventListener('click', async () => {
  const tbody = document.getElementById('pdf-items-tbody');
  const rows = tbody.querySelectorAll('tr');
  let importedCount = 0;

  rows.forEach(row => {
    const selected = row.querySelector('.pdf-row-select').checked;
    if (!selected) return;

    const index = row.querySelector('.pdf-row-select').getAttribute('data-index');
    const sku = row.querySelector('.pdf-row-sku').value.trim();
    const name = row.querySelector('.pdf-row-name').value.trim();
    const category = row.querySelector('.pdf-row-category').value;
    const costPrice = parseFloat(row.querySelector('.pdf-row-cost').value) || 0;
    const salePrice = parseFloat(row.querySelector('.pdf-row-sale').value) || 0;
    const qty = parseFloat(row.querySelector('.pdf-row-qty').value) || 0;

    // Buscar si ya existe por SKU o por Nombre original
    const existingIdx = state.products.findIndex(p => p.sku === sku || p.name.toLowerCase() === name.toLowerCase());

    if (existingIdx > -1) {
      // Actualizar producto existente
      state.products[existingIdx].stock = Number(state.products[existingIdx].stock) + qty;
      state.products[existingIdx].costPrice = costPrice;
      state.products[existingIdx].salePrice = salePrice;
      state.products[existingIdx].category = category;
      state.products[existingIdx].name = name;
    } else {
      // Crear producto nuevo
      const iconData = getProductIconData(name, category);
      const newProduct = {
        id: 'prod-' + Date.now() + Math.floor(Math.random() * 1000),
        name,
        sku,
        category,
        stock: qty,
        minStock: 2,
        costPrice,
        salePrice,
        supplierId: null,
        icon: iconData.icon,
        color: iconData.color
      };
      state.products.push(newProduct);
    }
    importedCount++;
  });

  if (importedCount > 0) {
    saveStateToLocalStorage(); // Esto dispara syncStateToSupabase() automáticamente en el fondo
    showToast(`¡Éxito! Se importaron/actualizaron ${importedCount} productos.`, 'success');
    renderInventory();
    closeModal('import-pdf-modal');
  } else {
    showToast('No seleccionó ningún producto para importar', 'warning');
  }
});

// Función de utilidad para calcular el stock de recetas basado en la disponibilidad de insumos
function getProductAvailableStock(prod) {
  if (!prod.recipe || prod.recipe.length === 0) {
    return Number(prod.stock);
  }
  
  let minAvailable = Infinity;
  prod.recipe.forEach(item => {
    const ingredient = state.products.find(p => p.id === item.id);
    if (ingredient) {
      const availableForThis = Math.floor(Number(ingredient.stock) / Number(item.qty));
      if (availableForThis < minAvailable) {
        minAvailable = availableForThis;
      }
    } else {
      minAvailable = 0; // Si falta un insumo
    }
  });
  
  return minAvailable === Infinity ? 0 : minAvailable;
}
window.getProductAvailableStock = getProductAvailableStock;


