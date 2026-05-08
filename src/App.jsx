import {
  Check,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const CART_STORAGE_KEY = "jcb-parts-cart-v1";

const formatPrice = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(number);
};

const normalize = (value) => String(value ?? "").toLowerCase().trim();

const clampPercent = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
};

const getMaterialKey = (part) => part.material || `${part.description}-${part.hsn}`;
const getBasePrice = (part) => Number(part.mrp || part.rtl || part.dnp || 0);

const calculateCart = (cartItems, orderDiscountPercent) => {
  const lineSubtotal = cartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const afterLineDiscount = cartItems.reduce((sum, item) => {
    const gross = item.unitPrice * item.quantity;
    return sum + gross * (1 - clampPercent(item.discountPercent) / 100);
  }, 0);
  const lineDiscount = lineSubtotal - afterLineDiscount;
  const orderDiscount = afterLineDiscount * (clampPercent(orderDiscountPercent) / 100);
  const grandTotal = afterLineDiscount - orderDiscount;

  return {
    afterLineDiscount,
    grandTotal,
    lineDiscount,
    lineSubtotal,
    orderDiscount,
  };
};

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [cartItems, setCartItems] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(CART_STORAGE_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [orderDiscountPercent, setOrderDiscountPercent] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let active = true;

    fetch("/catalog.json")
      .then((response) => {
        if (!response.ok) throw new Error("Catalog not found");
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        setCatalog(data);
        setStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems));
  }, [cartItems]);

  useEffect(() => {
    setSelectedKeys([]);
  }, [query]);

  const partsByKey = useMemo(() => {
    const map = new Map();
    for (const part of catalog?.parts ?? []) {
      map.set(getMaterialKey(part), part);
    }
    return map;
  }, [catalog]);

  const results = useMemo(() => {
    const parts = catalog?.parts ?? [];
    const term = normalize(query);

    if (!term) return parts.slice(0, 75);

    return parts
      .filter((part) => {
        return [part.material, part.description, part.hsn, part.cat1, part.cat2]
          .map(normalize)
          .some((value) => value.includes(term));
      })
      .slice(0, 150);
  }, [catalog, query]);

  const cartKeys = useMemo(() => new Set(cartItems.map((item) => item.key)), [cartItems]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const totals = useMemo(
    () => calculateCart(cartItems, orderDiscountPercent),
    [cartItems, orderDiscountPercent],
  );

  const selectedAvailableCount = selectedKeys.filter((key) => !cartKeys.has(key)).length;

  const toggleSelection = (key) => {
    setSelectedKeys((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
  };

  const addSelectedToCart = () => {
    const additions = selectedKeys
      .filter((key) => !cartKeys.has(key))
      .map((key) => {
        const part = partsByKey.get(key);
        return {
          cat1: part.cat1,
          cat2: part.cat2,
          description: part.description,
          discountPercent: 0,
          hsn: part.hsn,
          key,
          material: part.material,
          quantity: 1,
          unitPrice: getBasePrice(part),
        };
      });

    if (!additions.length) return;
    setCartItems((current) => [...current, ...additions]);
    setSelectedKeys([]);
    setIsCartOpen(true);
  };

  const updateCartItem = (key, updates) => {
    setCartItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...updates } : item)),
    );
  };

  const removeCartItem = (key) => {
    setCartItems((current) => current.filter((item) => item.key !== key));
  };

  return (
    <main className="app-shell">
      <section className="topbar" aria-labelledby="app-title">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            <Wrench size={24} />
          </span>
          <div>
            <h1 id="app-title">JCB Parts Store</h1>
            <p>{catalog ? `${catalog.rowCount.toLocaleString("en-IN")} parts loaded` : "Loading catalog"}</p>
          </div>
        </div>

        <div className="topbar-actions">
          <label className="search-box">
            <Search size={20} aria-hidden="true" />
            <input
              autoComplete="off"
              autoFocus
              disabled={status !== "ready"}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search material, description, HSN, or category"
              type="search"
              value={query}
            />
          </label>

          <button className="cart-button" type="button" onClick={() => setIsCartOpen(true)}>
            <ShoppingCart size={20} />
            <span>Cart</span>
            <strong>{cartItems.length}</strong>
          </button>
        </div>
      </section>

      {status === "loading" && <p className="state">Loading price list...</p>}
      {status === "error" && <p className="state error">Catalog data is missing. Run npm run import:catalog.</p>}

      {status === "ready" && (
        <div className="workspace">
          <section className="catalog-panel" aria-label="Parts catalog">
            <div className="panel-header">
              <div>
                <h2>Parts Catalog</h2>
                <p>
                  {results.length.toLocaleString("en-IN")} shown
                  {catalog?.sourceFile ? ` from ${catalog.sourceFile}` : ""}
                </p>
              </div>
              <button
                className="primary-action"
                disabled={!selectedAvailableCount}
                onClick={addSelectedToCart}
                type="button"
              >
                <Plus size={18} />
                Add selected
              </button>
            </div>

            <div className="parts-grid">
              {results.map((part) => {
                const key = getMaterialKey(part);
                const selected = selectedKeySet.has(key);
                const inCart = cartKeys.has(key);

                return (
                  <article className={`part-card${selected ? " selected" : ""}`} key={key}>
                    <label className="select-row">
                      <input
                        checked={selected}
                        disabled={inCart}
                        onChange={() => toggleSelection(key)}
                        type="checkbox"
                      />
                      <span>{inCart ? "In cart" : selected ? "Selected" : "Select"}</span>
                    </label>

                    <div className="part-info">
                      <strong>{part.material || "-"}</strong>
                      <h3>{part.description || "No description"}</h3>
                      <p>{[part.cat1, part.cat2].filter(Boolean).join(" / ") || "Uncategorized"}</p>
                    </div>

                    <div className="price-row">
                      <span>
                        <small>DNP</small>
                        {formatPrice(part.dnp)}
                      </span>
                      <span>
                        <small>RTL</small>
                        {formatPrice(part.rtl)}
                      </span>
                      <span className="mrp">
                        <small>MRP</small>
                        {formatPrice(part.mrp)}
                      </span>
                    </div>

                    <div className="meta-row">
                      <span>HSN {part.hsn || "-"}</span>
                      <span>GST {part.gst || "-"}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <CartPanel
            cartItems={cartItems}
            isOpen={isCartOpen}
            onClose={() => setIsCartOpen(false)}
            onOrderDiscountChange={setOrderDiscountPercent}
            onRemove={removeCartItem}
            onUpdate={updateCartItem}
            orderDiscountPercent={orderDiscountPercent}
            totals={totals}
          />
        </div>
      )}
    </main>
  );
}

function CartPanel({
  cartItems,
  isOpen,
  onClose,
  onOrderDiscountChange,
  onRemove,
  onUpdate,
  orderDiscountPercent,
  totals,
}) {
  return (
    <>
      <button
        aria-label="Close cart"
        className={`cart-backdrop${isOpen ? " open" : ""}`}
        onClick={onClose}
        type="button"
      />

      <aside className={`cart-panel${isOpen ? " open" : ""}`} aria-label="Cart">
        <div className="cart-header">
          <div>
            <h2>Cart</h2>
            <p>{cartItems.length.toLocaleString("en-IN")} selected parts</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close cart">
            <Minus size={20} />
          </button>
        </div>

        <div className="cart-lines">
          {!cartItems.length && (
            <div className="empty-cart">
              <ShoppingCart size={34} />
              <h3>No parts selected</h3>
              <p>Select parts from the catalog and add them to the cart.</p>
            </div>
          )}

          {cartItems.map((item) => {
            const gross = item.unitPrice * item.quantity;
            const lineTotal = gross * (1 - clampPercent(item.discountPercent) / 100);

            return (
              <article className="cart-line" key={item.key}>
                <div className="cart-line-title">
                  <div>
                    <strong>{item.material || "-"}</strong>
                    <p>{item.description || "-"}</p>
                  </div>
                  <button
                    className="icon-button danger"
                    onClick={() => onRemove(item.key)}
                    type="button"
                    aria-label={`Remove ${item.material}`}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>

                <div className="cart-controls">
                  <label>
                    Qty
                    <input
                      min="1"
                      onChange={(event) =>
                        onUpdate(item.key, {
                          quantity: Math.max(1, Number(event.target.value) || 1),
                        })
                      }
                      type="number"
                      value={item.quantity}
                    />
                  </label>
                  <label>
                    Item discount %
                    <input
                      max="100"
                      min="0"
                      onChange={(event) =>
                        onUpdate(item.key, {
                          discountPercent: clampPercent(event.target.value),
                        })
                      }
                      type="number"
                      value={item.discountPercent}
                    />
                  </label>
                </div>

                <div className="cart-line-total">
                  <span>{formatPrice(item.unitPrice)} each</span>
                  <strong>{formatPrice(lineTotal)}</strong>
                </div>
              </article>
            );
          })}
        </div>

        <div className="summary">
          <label className="order-discount">
            Order discount %
            <input
              max="100"
              min="0"
              onChange={(event) => onOrderDiscountChange(clampPercent(event.target.value))}
              type="number"
              value={orderDiscountPercent}
            />
          </label>

          <SummaryRow label="Subtotal" value={formatPrice(totals.lineSubtotal)} />
          <SummaryRow label="Item discounts" value={`-${formatPrice(totals.lineDiscount)}`} />
          <SummaryRow label="After item discounts" value={formatPrice(totals.afterLineDiscount)} />
          <SummaryRow label="Order discount" value={`-${formatPrice(totals.orderDiscount)}`} />
          <div className="grand-total">
            <span>Final price</span>
            <strong>{formatPrice(totals.grandTotal)}</strong>
          </div>

          {cartItems.length > 0 && (
            <p className="calc-note">
              <Check size={16} />
              Order discount is applied after per-item discounts.
            </p>
          )}
        </div>
      </aside>
    </>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="summary-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
