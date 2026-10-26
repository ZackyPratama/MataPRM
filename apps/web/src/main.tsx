import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import JsBarcode from 'jsbarcode'
import './style.css'

type User = { id: string; code: string; name: string; role: 'OWNER' | 'ASSISTANT' }
type Karat = { id: string; label: string }
type Movement = { id: string; type: string; fromStatus: string | null; toStatus: string; createdAt: string }
type GoldPrice = { karatId: string; pricePerGram: string }
type Item = { id: string; code: string; category: string; name: string; karatId: string; karat: Karat; weightMg: number; laborCost: string; status: string; note: string | null; version: number; movements?: Movement[] }
type FormData = { code: string; category: string; name: string; karatId: string; weightMg: string; laborCost: string; note: string }

const emptyForm: FormData = { code: '', category: 'CINCIN', name: '', karatId: '', weightMg: '', laborCost: '0', note: '' }

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}`, ...init?.headers } })
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message ?? 'Permintaan gagal.') }
  return response.status === 204 ? undefined as T : response.json()
}

function Barcode({ code }: { code: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => { if (ref.current) JsBarcode(ref.current, code, { format: 'CODE128', height: 52, width: 1.6, margin: 8, fontSize: 14 }) }, [code])
  return <svg ref={ref} aria-label={`Barcode ${code}`} />
}

function App() {
  const [token, setToken] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [karats, setKarats] = useState<Karat[]>([])
  const [prices, setPrices] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<Item | null>(null)
  const [form, setForm] = useState<FormData>(emptyForm)
  const [editing, setEditing] = useState<Item | null>(null)
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [page, setPage] = useState<'stock' | 'cashier'>('stock')
  const [cart, setCart] = useState<Item[]>([])
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'TRANSFER'>('CASH')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [lastSale, setLastSale] = useState<{ receiptNo: string; total: string; items: Item[] } | null>(null)

  async function load(currentToken = token, search = query) {
    const [itemResult, karatResult] = await Promise.all([
      request<{ items: Item[] }>('/api/items?' + new URLSearchParams({ query: search, take: '100' }), currentToken),
      request<Karat[]>('/api/karats', currentToken),
    ])
    setItems(itemResult.items); setKarats(karatResult)
    const currentPrices = await Promise.all(karatResult.map(async karat => { try { return await request<GoldPrice>(`/api/gold-prices/${karat.id}/current`, currentToken) } catch { return null } }))
    setPrices(Object.fromEntries(currentPrices.filter((price): price is GoldPrice => Boolean(price)).map(price => [price.karatId, price.pricePerGram])))
  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('')
    const data = new FormData(event.currentTarget)
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: data.get('code'), pin: data.get('pin') }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setToken(result.token); setUser(result.user); await load(result.token, '')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Login gagal.') }
  }

  async function openItem(id: string) {
    try { setSelected(await request<Item>(`/api/items/${id}`, token)) } catch (error) { setMessage(error instanceof Error ? error.message : 'Item gagal dimuat.') }
  }

  function beginEdit(item: Item) {
    setEditing(item); setForm({ code: item.code, category: item.category, name: item.name, karatId: item.karatId, weightMg: String(item.weightMg), laborCost: item.laborCost, note: item.note ?? '' })
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setMessage('')
    if (!user) return
    const payload = { code: form.code, category: form.category, name: form.name, karatId: form.karatId, weightMg: Number(form.weightMg), ...(user.role === 'OWNER' ? { laborCost: form.laborCost } : {}), note: form.note || undefined, ...(editing ? { version: editing.version } : {}) }
    try {
      await request(editing ? `/api/items/${editing.id}` : '/api/items', token, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      setForm(emptyForm); setEditing(null); setMessage('Item berhasil disimpan.'); await load()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Item gagal disimpan.') }
  }

  if (!token || !user) return <main className="login-shell"><section className="login-card"><div className="brand-mark">M</div><p className="eyebrow">MataPRM</p><h1>Masuk ke toko</h1><p>Gunakan kode akun dan PIN Anda.</p><form onSubmit={login}><label>Kode akun<input name="code" required autoComplete="username" placeholder="A" /></label><label>PIN<input name="pin" type="password" inputMode="numeric" minLength={6} required autoComplete="current-password" /></label><button type="submit">Masuk</button></form>{message && <p className="message error">{message}</p>}</section></main>

  function currency(value: string) {
    try { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(Number(value)) } catch { return value }
  }

  function removeFromCart(id: string) { setCart(prev => prev.filter(x => x.id !== id)) }

  function totalCart() { return cart.reduce((sum, item) => sum + Number(prices[item.karatId] || '0') * item.weightMg + Number(item.laborCost), 0) }

  async function checkout(event: React.FormEvent) {
    event.preventDefault(); setMessage('')
    if (!paymentAmount || Number(paymentAmount) < totalCart()) { setMessage('Jumlah pembayaran tidak mencukupi.'); return }
    const now = new Date()
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const receiptNo = `${user!.code}-${date}-${user!.code}-${cart.length.toString().padStart(3, '0')}`
    const payload = { opId: crypto.randomUUID(), saleId: crypto.randomUUID(), receiptNo, soldAt: now.toISOString(), itemIds: cart.map(item => item.id), discount: '0', payments: [{ id: crypto.randomUUID(), method: paymentMethod, amount: paymentAmount, reference: paymentMethod === 'CASH' ? 'TUNAI' : 'TRANSFER' }], note: '' }
    try { const sale = await request<{ items: { itemCode: string; itemName: string; karatLabel: string; weightMg: number; pricePerGram: string; laborCost: string; lineTotal: string }[]; total: string; receiptNo: string }>('/api/sales', token, { method: 'POST', body: JSON.stringify(payload) })
      setLastSale({ receiptNo: sale.receiptNo, total: String(sale.total), items: cart })
      setCart([]); setPaymentAmount('') } catch (error) { setMessage(error instanceof Error ? error.message : 'Penjualan gagal.') }
  }

  function CashierView() {
    return <div className="cashier-sheet"><header><div><h2>Kasir</h2><p className="sub">{user!.name} · {user!.role}</p><button className="ghost" onClick={() => { setPage('stock'); setCart([]); setPaymentMethod('CASH'); setPaymentAmount(''); setLastSale(null); setMessage('') }}>Ke stok</button></div></header><div className="cashier-body"><div className="cashier-cart"><div className="cart-head"><span>Item</span><span>Berat</span><span>Estimasi</span><span>Hapus</span></div>{cart.map(item => (<div key={item.id} className="cart-row"><div className="mono">{item.code}</div><span>{(item.weightMg / 1000).toFixed(2)} g</span><div className="num">{currency(prices[item.karatId] || '0')}</div><button className="link" onClick={() => removeFromCart(item.id)}>Hapus</button></div>))}</div><div className="cart-total"><strong>Subtotal</strong><strong>{totalCart().toLocaleString('id-ID')}</strong></div><form className="cashier-pay" onSubmit={checkout}><label>Jumlah pembayaran<input inputMode="numeric" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} placeholder="0" /></label><div className="pay-options"><label><input type="radio" name="pay" checked={paymentMethod === 'CASH'} onChange={() => setPaymentMethod('CASH')} /> Tunai</label><label><input type="radio" name="pay" checked={paymentMethod === 'TRANSFER'} onChange={() => setPaymentMethod('TRANSFER')} /> Transfer</label><p className="sub">Total dari server disesuaikan saat disimpan</p></div><div className="modal-actions"><button type="submit">Proses nota</button><button type="button" className="ghost" onClick={() => { setPage('stock'); setCart([]); setPaymentMethod('CASH'); setPaymentAmount(''); setLastSale(null); setMessage('') }}>Batal</button></div></form></div></div>
  }


  return (
    <>
      <div className="app-shell">
        <header>
          <div><p className="eyebrow">MataPRM</p><h1>Stok perhiasan</h1></div>
          <div className="user-box">
            <span>{user.name} · {user.role === 'OWNER' ? 'Pemilik' : 'Asisten'}</span>
            <button className="ghost" onClick={() => { void request('/api/auth/logout', token, { method: 'POST' }).catch(() => undefined); setToken(''); setUser(null); setItems([]); setSelected(null); setEditing(null) }}>Keluar</button>
          </div>
        </header>
        <main className="workspace">
          <section className="inventory">
            <div className="toolbar">
              <form onSubmit={e => { e.preventDefault(); void load() }}>
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari kode atau nama" aria-label="Cari item" />
                <button>Cari</button>
              </form>
              <span>{items.length} item ditampilkan</span>
            </div>
            {message && <p className="message">{message}</p>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Item</th>
                    <th>Kadar</th>
                    <th>Berat</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id}>
                      <td className="mono">{item.code}</td>
                      <td><strong>{item.name}</strong><small>{item.category}</small></td>
                      <td>{item.karat.label}</td>
                      <td>{(item.weightMg / 1000).toLocaleString('id-ID')} g</td>
                      <td><span className={`status ${item.status.toLowerCase()}`}>{item.status}</span></td>
                      <td>
                        <button className="link" onClick={() => void openItem(item.id)}>Detail</button>
                        <button className="link" onClick={() => beginEdit(item)}>Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <aside>
            <h2>{editing ? 'Edit item' : 'Tambah item'}</h2>
            <form onSubmit={save} className="item-form">
              <label>Kode barcode<input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} required /></label>
              <label>Nama/model<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
              <div className="form-row">
                <label>Jenis<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  <option>CINCIN</option><option>KALUNG</option><option>GELANG</option><option>ANTING</option><option>LIONTIN</option><option>LAINNYA</option>
                </select></label>
                <label>Kadar<select value={form.karatId} onChange={e => setForm({ ...form, karatId: e.target.value })} required>
                  <option value="">Pilih</option>
                  {karats.map(karat => <option key={karat.id} value={karat.id}>{karat.label}</option>)}
                </select></label>
              </div>
              <label>Berat (mg)<input type="number" min="1" value={form.weightMg} onChange={e => setForm({ ...form, weightMg: e.target.value })} required /></label>
              {user.role === 'OWNER' && <label>Ongkos (Rp)<input inputMode="numeric" value={form.laborCost} onChange={e => setForm({ ...form, laborCost: e.target.value })} required /></label>}
              <label>Catatan<textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
              <button type="submit">{editing ? 'Simpan perubahan' : 'Tambah ke stok'}</button>
              {editing && <button type="button" className="ghost" onClick={() => { setEditing(null); setForm(emptyForm) }}>Batal edit</button>}
            </form>
          </aside>
        </main>
        {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><article className="modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setSelected(null)} aria-label="Tutup">×</button><p className="eyebrow">Detail item</p><h2>{selected.name}</h2><div className="label-print"><Barcode code={selected.code} /><strong>{selected.name} · {selected.karat.label} · {(selected.weightMg / 1000).toLocaleString('id-ID')} g</strong></div><button onClick={() => window.print()}>Cetak label</button><h3>Riwayat stok</h3><ul className="movements">{selected.movements?.map(m => <li key={m.id}><span>{m.type}: {m.fromStatus ?? 'BARU'} → {m.toStatus}</span><time>{new Date(m.createdAt).toLocaleString('id-ID')}</time></li>)}</ul></article></div>}
        {page === 'cashier' && <CashierView />}
        {lastSale && <div className="modal-backdrop" onClick={() => setLastSale(null)}><article className="modal print-sheet" onClick={e => e.stopPropagation()}><p className="eyebrow">Nota</p><h1>Nota {lastSale.receiptNo}</h1><div className="note-items">{lastSale.items.map(it => <div key={it.id}><div className="mono">{it.code}</div><div className="thin">{it.name}</div><div className="thin">{it.karat.label}</div><div className="thin">{it.weightMg} mg</div><div className="thin">{prices[it.karatId] || '0'}</div><div className="thin">{it.laborCost}</div><div className="thin strong">{(it.weightMg * Number(prices[it.karatId] || '0') + Number(it.laborCost)).toLocaleString('id-ID')}</div></div>)}<div className="note-row"><div className="thin">Diskon</div><div className="thin">{currency('0')}</div><div className="thin">Total</div><div className="thin strong">{currency(lastSale.total)}</div></div><div className="modal-actions"><button onClick={() => window.print()}>Cetak</button><button onClick={() => setLastSale(null)}>Tutup</button></div></div></article></div>}
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
