const starter = [
  {id:'a1',name:'Camisa Linho Natural',price:189.90,desc:'Leveza e elegância para todos os dias.',image:'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=700&q=80',category:'Camisas',tag:'MAIS VENDIDO',mode:'both',link:''},
  {id:'a2',name:'Calça Reta Essencial',price:229.90,desc:'Caimento impecável e conforto absoluto.',image:'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?auto=format&fit=crop&w=700&q=80',category:'Calças',tag:'NOVO',mode:'internal',link:''},
  {id:'a3',name:'Jaqueta Urbana',price:319.90,desc:'Uma camada extra de atitude e versatilidade.',image:'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=700&q=80',category:'Jaquetas',tag:'EDIÇÃO ESPECIAL',mode:'external',link:'https://example.com'},
  {id:'a4',name:'Vestido Horizonte',price:259.90,desc:'Silhueta fluida para acompanhar seu movimento.',image:'https://images.unsplash.com/photo-1539008835657-9e8e9680c956?auto=format&fit=crop&w=700&q=80',category:'Vestidos',tag:'',mode:'internal',link:''}
];

let products = JSON.parse(localStorage.getItem('vertice_products') || 'null') || starter;
let cart = [];
let settings = JSON.parse(localStorage.getItem('vertice_settings') || '{}');
let activePaymentMethod = 'card';

// CREDENCIAIS ADMINISTRATIVAS EXCLUSIVAS
const ADMIN_USER = { name: 'Administrador', email: 'admin@vertice.com', password: 'admin123', role: 'admin' };

let registeredUsers = JSON.parse(localStorage.getItem('vertice_users') || '[]');
let currentUser = JSON.parse(localStorage.getItem('vertice_current_user') || 'null');

const $ = id => document.getElementById(id);
const money = v => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const persist = () => localStorage.setItem('vertice_products', JSON.stringify(products));

function toast(s) {
  $('toast').textContent = s;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2600);
}

/* --- AUTENTICAÇÃO --- */
function openAuthModal(mode = 'login') {
  switchAuthTab(mode);
  $('authOverlay').classList.add('open');
}

function closeAuthModal() {
  $('authOverlay').classList.remove('open');
}

function switchAuthTab(mode) {
  if (mode === 'login') {
    $('authModalTitle').textContent = 'Acessar Conta';
    $('loginFormView').style.display = 'block';
    $('registerFormView').style.display = 'none';
  } else {
    $('authModalTitle').textContent = 'Criar Nova Conta';
    $('loginFormView').style.display = 'none';
    $('registerFormView').style.display = 'block';
  }
}

function handleLogin(e) {
  e.preventDefault();
  const email = $('loginEmail').value.trim().toLowerCase();
  const password = $('loginPassword').value;

  if (email === ADMIN_USER.email && password === ADMIN_USER.password) {
    currentUser = ADMIN_USER;
    saveSession();
    toast('Bem-vindo, Administrador!');
    closeAuthModal();
    updateUIForUser();
    return;
  }

  const user = registeredUsers.find(u => u.email.toLowerCase() === email && u.password === password);
  if (user) {
    currentUser = user;
    saveSession();
    toast(`Bem-vindo(a), ${user.name}!`);
    closeAuthModal();
    updateUIForUser();
  } else {
    toast('E-mail ou senha incorretos.');
  }
}

function handleRegister(e) {
  e.preventDefault();
  const name = $('regName').value.trim();
  const email = $('regEmail').value.trim().toLowerCase();
  const password = $('regPassword').value;

  if (email === ADMIN_USER.email || registeredUsers.some(u => u.email.toLowerCase() === email)) {
    toast('Este e-mail já está em uso.');
    return;
  }

  const newUser = { name, email, password, role: 'client' };
  registeredUsers.push(newUser);
  localStorage.setItem('vertice_users', JSON.stringify(registeredUsers));

  currentUser = newUser;
  saveSession();
  toast('Conta de cliente criada com sucesso!');
  closeAuthModal();
  updateUIForUser();
}

function saveSession() {
  localStorage.setItem('vertice_current_user', JSON.stringify(currentUser));
}

function logoutUser() {
  currentUser = null;
  localStorage.removeItem('vertice_current_user');
  updateUIForUser();
  toast('Você saiu da sua conta.');
}

function updateUIForUser() {
  if (currentUser) {
    $('userAuthNav').style.display = 'none';
    $('userInfoNav').style.display = 'flex';
    $('userGreeting').textContent = `Olá, ${currentUser.name}`;

    if (currentUser.role === 'admin') {
      $('adminFab').style.display = 'block';
    } else {
      $('adminFab').style.display = 'none';
      closeAdmin();
    }
  } else {
    $('userAuthNav').style.display = 'block';
    $('userInfoNav').style.display = 'none';
    $('adminFab').style.display = 'none';
    closeAdmin();
  }
}

/* --- SACOLA DE COMPRAS --- */
function renderProducts() {
  $('products').innerHTML = products.map(p => `
    <article class="product">
      <div class="product-photo">
        <img src="${esc(p.image||'')}" alt="${esc(p.name)}" onerror="this.src='https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=700&q=80'">
        ${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}
      </div>
      <div class="product-info">
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.desc)}</p>
        <span class="price">${money(p.price)}</span>
        <div class="product-actions">
          ${p.mode !== 'external' ? `<button class="solid" onclick="addCart('${p.id}')">ADICIONAR</button>` : ''}
          ${p.link && p.mode !== 'internal' ? `<button class="outline" onclick="window.open('${esc(p.link)}','_blank','noopener')">COMPRAR ↗</button>` : ''}
        </div>
      </div>
    </article>
  `).join('');
  $('productCountLabel').textContent = `${String(products.length).padStart(2, '0')} PRODUTOS`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function addCart(id) {
  let p = products.find(x => x.id === id);
  if (!p) return;
  cart.push(p);
  $('cartCount').textContent = cart.length;
  toast('Produto adicionado à sacola.');
}

function openCart() { renderCart(); $('cart').classList.add('open'); }
function closeCart() { $('cart').classList.remove('open'); }

function renderCart() {
  $('cartItems').innerHTML = cart.length ? cart.map((p, i) => `
    <div class="cart-row">
      <img src="${esc(p.image)}">
      <div>
        <strong>${esc(p.name)}</strong>
        <p>${money(p.price)}</p>
        <button onclick="removeCart(${i})">Remover</button>
      </div>
    </div>
  `).join('') : '<p style="color:#777">Sua sacola está vazia.</p>';
  $('cartTotal').textContent = money(cart.reduce((a, p) => a + Number(p.price), 0));
}

function removeCart(i) {
  cart.splice(i, 1);
  $('cartCount').textContent = cart.length;
  renderCart();
}

/* --- FLUXO DE CHECKOUT E INTEGRAÇÃO MERCADO PAGO --- */
function openCheckout() {
  if (!cart.length) {
    toast('Adicione pelo menos um produto na sacola.');
    return;
  }
  
  if (!currentUser) {
    toast('Por favor, faça login ou crie uma conta para comprar.');
    closeCart();
    openAuthModal('login');
    return;
  }

  const total = cart.reduce((a, p) => a + Number(p.price), 0);
  $('checkoutSummary').innerHTML = `
    <strong>Resumo do Pedido:</strong> ${cart.length} item(ns)<br>
    <strong>Total:</strong> <span style="font-size:15px; font-weight:bold; color:#243b35;">${money(total)}</span>
  `;

  closeCart();
  $('checkoutOverlay').classList.add('open');
}

function closeCheckout() {
  $('checkoutOverlay').classList.remove('open');
}

function selectPaymentMethod(method) {
  activePaymentMethod = method;
  ['Card', 'Pix', 'Boleto'].forEach(m => {
    const btn = $('payBtn' + m);
    if (m.toLowerCase() === method) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  $('cardPaymentView').style.display = method === 'card' ? 'block' : 'none';
  $('pixPaymentView').style.display = method === 'pix' ? 'block' : 'none';
  $('boletoPaymentView').style.display = method === 'boleto' ? 'block' : 'none';
}

async function processPayment(e) {
  e.preventDefault();
  const total = cart.reduce((a, p) => a + Number(p.price), 0);
  const cpf = $('cftCpf').value.trim();
  const phone = $('cftPhone').value.trim();
  const address = $('cftAddress').value.trim();

  if (activePaymentMethod === 'card') {
    const cardNum = $('cardNum').value.trim();
    if (!cardNum || cardNum.length < 13) {
      toast('Informe um número de cartão válido.');
      return;
    }
  }

  closeCheckout();

  // Se você estiver rodando o servidor Node.js localmente, mude para 'http://localhost:3000/api/processar-pix' ou cartão.
  // Abaixo está a estrutura pronta para conectar com o Backend:
  const dadosPagamento = {
    valor: activePaymentMethod === 'pix' ? total * 0.95 : total,
    metodo: activePaymentMethod,
    email: currentUser.email,
    nome: currentUser.name,
    cpf,
    phone,
    address
  };

  try {
    // Exemplo de integração com o servidor backend:
    /*
    const endpoint = activePaymentMethod === 'pix' ? 'http://localhost:3000/api/processar-pix' : 'http://localhost:3000/api/processar-cartao';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dadosPagamento)
    });
    const resultado = await res.json();
    */

    // Simulação interativa avançada integrada ao Mercado Pago:
    const orderId = 'MP-' + Math.floor(100000 + Math.random() * 900000);
    cart = [];
    $('cartCount').textContent = '0';
    renderCart();

    if (activePaymentMethod === 'pix') {
      const pixTotal = total * 0.95;
      $('successMessage').innerHTML = `Cobrança Pix <strong>#${orderId}</strong> criada via Mercado Pago!<br>Valor com 5% de desconto: <strong>${money(pixTotal)}</strong>.<br><small style="color:#2e7d32">O dinheiro cairá diretamente na sua conta conectada ao aprovar.</small>`;
      $('pixQrContainer').style.display = 'block';
    } else if (activePaymentMethod === 'card') {
      $('successMessage').innerHTML = `Pagamento aprovado com sucesso! (ID: <strong>#${orderId}</strong>)<br>O valor de <strong>${money(total)}</strong> foi processado e transferido para a sua conta.`;
      $('pixQrContainer').style.display = 'none';
    } else {
      $('successMessage').innerHTML = `Boleto <strong>#${orderId}</strong> emitido com sucesso!<br>Valor: <strong>${money(total)}</strong>.`;
      $('pixQrContainer').style.display = 'none';
    }

    $('orderSuccessOverlay').classList.add('open');

  } catch (err) {
    toast('Erro de comunicação com o gateway de pagamento.');
    console.error(err);
  }
}

function closeSuccessModal() {
  $('orderSuccessOverlay').classList.remove('open');
}

/* --- PAINEL DO ADMINISTRADOR --- */
function openAdmin() {
  if (!currentUser || currentUser.role !== 'admin') {
    toast('Acesso restrito ao Administrador.');
    return;
  }
  $('adminOverlay').classList.add('open');
  loadAdmin();
}

function closeAdmin() {
  $('adminOverlay').classList.remove('open');
}

function showTab(id, b) {
  document.querySelectorAll('.admin-content > div').forEach(x => x.style.display = 'none');
  $(id).style.display = 'block';
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  if (id === 'productsTab') renderAdminProducts();
}

function renderAdminProducts() {
  $('adminProducts').innerHTML = products.map(p => `
    <div class="admin-item">
      <img src="${esc(p.image)}">
      <div>
        <strong>${esc(p.name)}</strong>
        <small>${money(p.price)} · ${esc(p.category || 'Sem categoria')}</small>
      </div>
      <button onclick="editProduct('${p.id}')">Editar</button>
      <button onclick="deleteProduct('${p.id}')">Excluir</button>
    </div>
  `).join('') || '<p>Nenhum produto cadastrado.</p>';
}

function newProduct() {
  clearEditor();
  $('productEditor').style.display = 'block';
  $('editorTitle').textContent = 'Novo produto';
}

function clearEditor() {
  ['editId', 'pName', 'pPrice', 'pDesc', 'pImageUrl', 'pLink', 'pCategory', 'pTag'].forEach(id => $(id).value = '');
  $('pImages').value = '';
  $('pMode').value = 'internal';
}

function cancelEditor() {
  $('productEditor').style.display = 'none';
}

function editProduct(id) {
  let p = products.find(x => x.id === id);
  if (!p) return;
  newProduct();
  $('editorTitle').textContent = 'Editar produto';
  $('editId').value = p.id;
  $('pName').value = p.name;
  $('pPrice').value = p.price;
  $('pDesc').value = p.desc;
  $('pImageUrl').value = p.image;
  $('pLink').value = p.link || '';
  $('pMode').value = p.mode;
  $('pCategory').value = p.category || '';
  $('pTag').value = p.tag || '';
}

async function saveProduct() {
  let id = $('editId').value || 'p' + Date.now();
  let old = products.find(x => x.id === id);
  let image = $('pImageUrl').value || old?.image || '';
  let files = [...$('pImages').files];
  if (files.length) {
    image = await fileToData(files[0]);
  }
  if (!$('pName').value.trim() || !$('pPrice').value || !image) {
    toast('Preencha nome, valor e uma foto.');
    return;
  }
  let p = {
    id,
    name: $('pName').value.trim(),
    price: Number($('pPrice').value),
    desc: $('pDesc').value,
    image,
    link: $('pLink').value,
    mode: $('pMode').value,
    category: $('pCategory').value,
    tag: $('pTag').value
  };
  if (old) products = products.map(x => x.id === id ? p : x);
  else products.push(p);
  persist();
  renderProducts();
  renderAdminProducts();
  cancelEditor();
  toast('Produto salvo nesta prévia.');
}

function fileToData(f) {
  return new Promise((res, rej) => {
    let r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(f);
  });
}

function deleteProduct(id) {
  if (confirm('Excluir este produto?')) {
    products = products.filter(x => x.id !== id);
    persist();
    renderProducts();
    renderAdminProducts();
    toast('Produto excluído.');
  }
}

function loadAdmin() {
  renderAdminProducts();
  $('sAnnouncement').value = $('announcement').textContent;
  $('sBrand').value = $('brand').textContent;
  $('sEyebrow').value = $('heroEyebrow').textContent;
  $('sHeroTitle').value = $('heroTitle').innerText;
  $('sHeroText').value = $('heroText').textContent;
  $('sHeroButton').value = $('heroButton').textContent;
  $('sHeroImage').value = $('heroImage').src;
  $('sHeroLabel').value = $('heroLabel').textContent;
  $('sProductsTitle').value = $('productsTitle').textContent;
  $('sAboutTitle').value = $('aboutTitle').textContent;
  $('sAboutText').value = $('aboutText').textContent;
  $('sAboutImage').value = $('aboutImage').src;
  $('sV1').value = $('value1Title').textContent;
  $('sV1t').value = $('value1Text').textContent;
  $('sV2').value = $('value2Title').textContent;
  $('sV2t').value = $('value2Text').textContent;
  $('sV3').value = $('value3Title').textContent;
  $('sV3t').value = $('value3Text').textContent;
  $('sFooter').value = $('footerText').textContent;
}

function saveHome() {
  setText('announcement', $('sAnnouncement').value);
  setText('brand', $('sBrand').value);
  setText('footerBrand', $('sBrand').value + ' © 2026');
  setText('heroEyebrow', $('sEyebrow').value);
  $('heroTitle').innerText = $('sHeroTitle').value;
  setText('heroText', $('sHeroText').value);
  setText('heroButton', $('sHeroButton').value);
  $('heroImage').src = $('sHeroImage').value;
  setText('heroLabel', $('sHeroLabel').value);
  setText('productsTitle', $('sProductsTitle').value);
  storeSettings();
  toast('Página inicial atualizada.');
}

function saveAbout() {
  setText('aboutTitle', $('sAboutTitle').value);
  setText('aboutText', $('sAboutText').value);
  $('aboutImage').src = $('sAboutImage').value;
  [['value1Title', 'sV1'], ['value1Text', 'sV1t'], ['value2Title', 'sV2'], ['value2Text', 'sV2t'], ['value3Title', 'sV3'], ['value3Text', 'sV3t']].forEach(([a, b]) => setText(a, $(b).value));
  storeSettings();
  toast('Seção da marca atualizada.');
}

function saveFooter() {
  setText('footerText', $('sFooter').value);
  storeSettings();
  toast('Rodapé atualizado.');
}

function setText(id, v) { $(id).textContent = v; }
function storeSettings() {
  let s = {
    announcement: $('announcement').textContent,
    brand: $('brand').textContent,
    heroTitle: $('heroTitle').innerText,
    heroText: $('heroText').textContent,
    heroImage: $('heroImage').src,
    aboutTitle: $('aboutTitle').textContent,
    aboutText: $('aboutText').textContent
  };
  localStorage.setItem('vertice_settings', JSON.stringify(s));
}

function applySettings() {
  if (!Object.keys(settings).length) return;
  for (let [k, v] of Object.entries(settings)) {
    let map = { announcement: 'announcement', brand: 'brand', heroTitle: 'heroTitle', heroText: 'heroText', heroImage: 'heroImage', aboutTitle: 'aboutTitle', aboutText: 'aboutText' };
    let id = map[k];
    if (!id) continue;
    if (k.toLowerCase().includes('image')) $(id).src = v;
    else $(id).textContent = v;
  }
}

// Inicialização
applySettings();
renderProducts();
updateUIForUser();
