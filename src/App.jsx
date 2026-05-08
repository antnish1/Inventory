import {
  Check,
  FolderPlus,
  Heart,
  KeyRound,
  Layers3,
  Search,
  ShoppingCart,
  Trash2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const CART_STORAGE_KEY = "jcb-parts-cart-v1";
const SAVED_STORAGE_KEY = "jcb-parts-saved-v1";
const LISTS_STORAGE_KEY = "jcb-parts-lists-v1";
const CATALOG_OVERRIDE_KEY = "jcb-parts-catalog-override-v1";
const ADMIN_PASSWORD = "000007";
const REQUIRED_COLUMNS = ["Material", "Description", "DNP", "RTL", "MRP", "HSN", "GST", "Cat 1", "Cat 2"];
const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "";

const apiUrl = (path) => `${API_BASE}${path}`;

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
const normalizeText = (value) => String(value ?? "").trim();
const normalizePrice = (value) => {
  if (value === null || value === undefined || value === "") return "";
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : "";
};

const clampPercent = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, number));
};

const getMaterialKey = (part) => part.material || `${part.description}-${part.hsn}`;
const getBasePrice = (part) => Number(part.mrp || part.rtl || part.dnp || 0);

const scorePart = (part, term) => {
  if (!term) return 1;

  const material = normalize(part.material);
  const description = normalize(part.description);
  const words = term.split(/\s+/).filter(Boolean);
  let score = 0;

  if (material === term) score += 1200;
  if (material.startsWith(term)) score += 900;
  if (material.includes(term)) score += 650;
  if (description.startsWith(term)) score += 450;
  if (description.includes(term)) score += 280;

  for (const word of words) {
    if (material.includes(word)) score += 120;
    if (description.includes(word)) score += 70;
  }

  return score;
};

const calculateCart = (cartItems, orderDiscountPercent) => {
  const lineSubtotal = cartItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const afterLineDiscount = cartItems.reduce((sum, item) => {
    const gross = item.unitPrice * item.quantity;
    return sum + gross * (1 - clampPercent(item.discountPercent) / 100);
  }, 0);
  const lineDiscount = lineSubtotal - afterLineDiscount;
  const orderDiscount = afterLineDiscount * (clampPercent(orderDiscountPercent) / 100);

  return {
    afterLineDiscount,
    grandTotal: afterLineDiscount - orderDiscount,
    lineDiscount,
    lineSubtotal,
    orderDiscount,
  };
};

const parseWorkbook = async (file) => {
  const XLSX = await import("xlsx");
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: "array", cellDates: false });
  const firstSheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: "", raw: true });
  const headers = Object.keys(rows[0] ?? {});
  const missing = REQUIRED_COLUMNS.filter((column) => !headers.includes(column));

  if (missing.length) {
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }

  const parts = rows
    .map((row) => ({
      material: normalizeText(row.Material),
      description: normalizeText(row.Description),
      dnp: normalizePrice(row.DNP),
      rtl: normalizePrice(row.RTL),
      mrp: normalizePrice(row.MRP),
      hsn: normalizeText(row.HSN),
      gst: normalizeText(row.GST),
      cat1: normalizeText(row["Cat 1"]),
      cat2: normalizeText(row["Cat 2"]),
    }))
    .filter((part) => part.material || part.description);

  return {
    importedAt: new Date().toISOString(),
    parts,
    requiredColumns: REQUIRED_COLUMNS,
    rowCount: parts.length,
    sourceFile: file.name,
  };
};

const loadCatalog = async () => {
  if (API_BASE) {
    try {
      const response = await fetch(apiUrl("/catalog"));
      if (!response.ok) throw new Error("Cloudflare catalog not found");
      return response.json();
    } catch (error) {
      console.warn("Cloudflare catalog failed, using deployed catalog fallback.", error);
    }
  }

  const response = await fetch("/catalog.json");
  if (!response.ok) throw new Error("Catalog not found");
  return response.json();
};

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [cartItems, setCartItems] = useStoredState(CART_STORAGE_KEY, []);
  const [lists, setLists] = useStoredState(LISTS_STORAGE_KEY, []);
  const [savedKeys, setSavedKeys] = useStoredState(SAVED_STORAGE_KEY, []);
  const [activePart, setActivePart] = useState(null);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isListsOpen, setIsListsOpen] = useState(false);
  const [listTargetPart, setListTargetPart] = useState(null);
  const [orderDiscountPercent, setOrderDiscountPercent] = useState(0);
  const [query, setQuery] = useState("");
  const [showSavedOnly, setShowSavedOnly] = useState(true);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    let active = true;
    const override = localStorage.getItem(CATALOG_OVERRIDE_KEY);

    if (!API_BASE && override) {
      try {
        setCatalog(JSON.parse(override));
        setStatus("ready");
        return () => {
          active = false;
        };
      } catch {
        localStorage.removeItem(CATALOG_OVERRIDE_KEY);
      }
    }

    loadCatalog()
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
    if (!API_BASE) return;

    let active = true;

    Promise.all([
      fetch(apiUrl("/saved")).then((response) => {
        if (!response.ok) throw new Error("Saved list not found");
        return response.json();
      }),
      fetch(apiUrl("/lists")).then((response) => {
        if (!response.ok) throw new Error("Named lists not found");
        return response.json();
      }),
    ])
      .then(([savedData, listsData]) => {
        if (!active) return;
        setSavedKeys(Array.isArray(savedData.keys) ? savedData.keys : []);
        setLists(Array.isArray(listsData.lists) ? listsData.lists : []);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [setLists, setSavedKeys]);

  const persistSavedKeys = (keys) => {
    if (!API_BASE) return;

    fetch(apiUrl("/saved"), {
      body: JSON.stringify({ keys }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }).catch(() => {});
  };

  const persistLists = (nextLists) => {
    if (!API_BASE) return;

    fetch(apiUrl("/lists"), {
      body: JSON.stringify({ lists: nextLists }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    }).catch(() => {});
  };

  const clearSaved = () => {
    setSavedKeys([]);
    persistSavedKeys([]);
  };

  const clearCart = () => {
    setCartItems([]);
  };

  const createList = (name) => {
    const cleanName = name.trim();
    if (!cleanName) return "List name is required.";

    const exists = lists.some((list) => list.name.toLowerCase() === cleanName.toLowerCase());
    if (exists) return "A list with this name already exists.";

    const nextLists = [...lists, { name: cleanName, keys: [] }];
    setLists(nextLists);
    persistLists(nextLists);
    return "";
  };

  const deleteList = (name) => {
    const nextLists = lists.filter((list) => list.name !== name);
    setLists(nextLists);
    persistLists(nextLists);
  };

  const togglePartInList = (name, part) => {
    const key = getMaterialKey(part);
    const nextLists = lists.map((list) => {
      if (list.name !== name) return list;
      return {
        ...list,
        keys: list.keys.includes(key)
          ? list.keys.filter((item) => item !== key)
          : [...list.keys, key],
      };
    });

    setLists(nextLists);
    persistLists(nextLists);
  };

  const clearList = (name) => {
    const nextLists = lists.map((list) => (list.name === name ? { ...list, keys: [] } : list));
    setLists(nextLists);
    persistLists(nextLists);
  };

  const savedKeySet = useMemo(() => new Set(savedKeys), [savedKeys]);
  const cartKeys = useMemo(() => new Set(cartItems.map((item) => item.key)), [cartItems]);
  const totals = useMemo(
    () => calculateCart(cartItems, orderDiscountPercent),
    [cartItems, orderDiscountPercent],
  );

  const results = useMemo(() => {
    const term = normalize(query);
    let parts = catalog?.parts ?? [];

    if (showSavedOnly) {
      parts = parts.filter((part) => savedKeySet.has(getMaterialKey(part)));
    }

    if (!term) return parts.slice(0, 120);

    return parts
      .map((part) => ({ part, score: scorePart(part, term) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.part.description.localeCompare(b.part.description))
      .map((item) => item.part)
      .slice(0, 200);
  }, [catalog, query, savedKeySet, showSavedOnly]);

  const addToCart = (part) => {
    const key = getMaterialKey(part);
    if (cartKeys.has(key)) {
      setIsCartOpen(true);
      return;
    }

    setCartItems((current) => [
      ...current,
      {
        cat1: part.cat1,
        cat2: part.cat2,
        description: part.description,
        discountPercent: 0,
        gst: part.gst,
        hsn: part.hsn,
        key,
        material: part.material,
        quantity: 1,
        unitPrice: getBasePrice(part),
      },
    ]);
  };

  const toggleSaved = (part) => {
    const key = getMaterialKey(part);
    setSavedKeys((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];

      if (API_BASE) {
        persistSavedKeys(next);
      }

      return next;
    });
  };

  const updateCartItem = (key, updates) => {
    setCartItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...updates } : item)),
    );
  };

  const removeCartItem = (key) => {
    setCartItems((current) => current.filter((item) => item.key !== key));
  };

  const applyCatalogOverride = async (nextCatalog, password) => {
    if (API_BASE) {
      const response = await fetch(apiUrl("/catalog"), {
        body: JSON.stringify(nextCatalog),
        headers: {
          "content-type": "application/json",
          "x-admin-password": password,
        },
        method: "PUT",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Cloudflare upload failed.");
      }
    } else {
      localStorage.setItem(CATALOG_OVERRIDE_KEY, JSON.stringify(nextCatalog));
    }

    setCatalog(nextCatalog);
    setStatus("ready");
    setQuery("");
  };

  const resetCatalog = () => {
    if (API_BASE) return;
    localStorage.removeItem(CATALOG_OVERRIDE_KEY);
    window.location.reload();
  };

  return (
    <main className="app-shell">
      <section className="app-hero" aria-labelledby="app-title">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            <Wrench size={22} />
          </span>
          <div>
            <h1 id="app-title">JCB Parts</h1>
            <p>{catalog ? `${catalog.rowCount.toLocaleString("en-IN")} parts` : "Loading catalog"}</p>
          </div>
        </div>

        <div className="hero-actions">
          <button className="chip-button" type="button" onClick={() => setIsListsOpen(true)} aria-label="Open lists">
            <Layers3 size={18} />
          </button>
          <button className="chip-button" type="button" onClick={() => setIsAdminOpen(true)} aria-label="Admin upload">
            <Upload size={18} />
          </button>
          <button className="cart-pill" type="button" onClick={() => setIsCartOpen(true)} aria-label="Open cart">
            <ShoppingCart size={18} />
            <strong>{cartItems.length}</strong>
          </button>
        </div>
      </section>

      <section className="search-panel">
        <label className="search-box">
          <Search size={19} aria-hidden="true" />
          <input
            autoComplete="off"
            autoFocus
            disabled={status !== "ready"}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search part number or description"
            type="search"
            value={query}
          />
        </label>
        <button
          className={`filter-button${showSavedOnly ? " active" : ""}`}
          onClick={() => setShowSavedOnly((value) => !value)}
          type="button"
          aria-label={showSavedOnly ? "Show all parts" : "Show saved parts"}
        >
          <Heart size={18} fill={showSavedOnly ? "currentColor" : "none"} />
        </button>
      </section>

      {status === "loading" && <p className="state">Loading price list...</p>}
      {status === "error" && <p className="state error">Catalog data is missing. Run npm run import:catalog.</p>}

      {status === "ready" && (
        <section className="catalog-panel" aria-label="Parts catalog">
          <div className="list-status">
            <span>{showSavedOnly ? "Saved items" : "All parts"} · {results.length.toLocaleString("en-IN")} results</span>
            <span>{catalog?.sourceFile}</span>
          </div>

          {showSavedOnly && savedKeys.length > 0 && (
            <div className="panel-tools">
              <button className="secondary-action compact" type="button" onClick={clearSaved}>
                Clear saved
              </button>
            </div>
          )}

          <div className="product-list">
            {results.length === 0 && (
              <div className="empty-list">
                <Heart size={30} />
                <h3>{showSavedOnly ? "No saved items yet" : "No parts found"}</h3>
                <p>{showSavedOnly ? "Tap the heart on any part to save it here." : "Try another part number or description."}</p>
              </div>
            )}
            {results.map((part) => {
              const key = getMaterialKey(part);
              const saved = savedKeySet.has(key);
              const inCart = cartKeys.has(key);

              return (
                <article className="product-row" key={key}>
                  <button className="row-main" type="button" onClick={() => setActivePart(part)}>
                    <span className="material-code">{part.material || "-"}</span>
                    <span className="part-name">{part.description || "No description"}</span>
                  </button>

                  <div className="row-price">
                    <strong>{formatPrice(part.mrp)}</strong>
                  </div>

                  <div className="row-actions">
                    <button
                      className={`icon-button save${saved ? " active" : ""}`}
                      type="button"
                      onClick={() => toggleSaved(part)}
                      aria-label={saved ? "Unsave part" : "Save part"}
                    >
                      <Heart size={18} fill={saved ? "currentColor" : "none"} />
                    </button>
                    <button
                      className={`icon-button cart${inCart ? " active" : ""}`}
                      type="button"
                      onClick={() => addToCart(part)}
                      aria-label={inCart ? "Part already in cart" : "Add to cart"}
                    >
                      {inCart ? <Check size={18} /> : <ShoppingCart size={18} />}
                    </button>
                    <button
                      className="icon-button list"
                      type="button"
                      onClick={() => {
                        setListTargetPart(part);
                        setIsListsOpen(true);
                      }}
                      aria-label="Add to list"
                    >
                      <FolderPlus size={18} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <CartPanel
        cartItems={cartItems}
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        onOrderDiscountChange={setOrderDiscountPercent}
        onRemove={removeCartItem}
        onUpdate={updateCartItem}
        orderDiscountPercent={orderDiscountPercent}
        totals={totals}
        onClearCart={clearCart}
      />
      <ListsPanel
        isOpen={isListsOpen}
        lists={lists}
        onClearList={clearList}
        onClose={() => {
          setIsListsOpen(false);
          setListTargetPart(null);
        }}
        onCreateList={createList}
        onDeleteList={deleteList}
        onTogglePart={togglePartInList}
        targetPart={listTargetPart}
      />
      <DetailsPanel part={activePart} onAddToCart={addToCart} onClose={() => setActivePart(null)} />
      <AdminPanel
        catalog={catalog}
        isOpen={isAdminOpen}
        onClose={() => setIsAdminOpen(false)}
        onImport={applyCatalogOverride}
        onReset={resetCatalog}
      />
    </main>
  );
}

function useStoredState(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}

function CartPanel({
  cartItems,
  isOpen,
  onClearCart,
  onClose,
  onOrderDiscountChange,
  onRemove,
  onUpdate,
  orderDiscountPercent,
  totals,
}) {
  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Cart" subtitle={`${cartItems.length.toLocaleString("en-IN")} parts`}>
      {cartItems.length > 0 && (
        <div className="panel-tools in-drawer">
          <button className="secondary-action compact danger-text" type="button" onClick={onClearCart}>
            Clear cart
          </button>
        </div>
      )}
      <div className="cart-lines">
        {!cartItems.length && (
          <div className="empty-cart">
            <ShoppingCart size={34} />
            <h3>No parts selected</h3>
            <p>Add parts from search results.</p>
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
                  Discount %
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
      </div>
    </Drawer>
  );
}

function ListsPanel({
  isOpen,
  lists,
  onClearList,
  onClose,
  onCreateList,
  onDeleteList,
  onTogglePart,
  targetPart,
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const submit = (event) => {
    event.preventDefault();
    const error = onCreateList(name);
    setMessage(error || "List created.");
    if (!error) setName("");
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Item lists"
      subtitle={targetPart ? `Add ${targetPart.material || "part"}` : `${lists.length} lists`}
    >
      <div className="lists-body">
        <form className="list-create" onSubmit={submit}>
          <label>
            New list name
            <input
              onChange={(event) => setName(event.target.value)}
              placeholder="Example: Backhoe service"
              type="text"
              value={name}
            />
          </label>
          <button className="wide-action no-margin" type="submit">
            Create list
          </button>
          {message && <p className="admin-message">{message}</p>}
        </form>

        <div className="named-lists">
          {!lists.length && (
            <div className="empty-cart compact-empty">
              <Layers3 size={30} />
              <h3>No lists yet</h3>
              <p>Create named lists for jobs, machines, or customers.</p>
            </div>
          )}

          {lists.map((list) => {
            const hasTarget = Boolean(targetPart && list.keys.includes(getMaterialKey(targetPart)));

            return (
              <article className="named-list" key={list.name}>
                <div>
                  <strong>{list.name}</strong>
                  <p>{list.keys.length.toLocaleString("en-IN")} items</p>
                </div>
                <div className="list-actions">
                  {targetPart && (
                    <button
                      className={`secondary-action compact${hasTarget ? " selected-list" : ""}`}
                      onClick={() => onTogglePart(list.name, targetPart)}
                      type="button"
                    >
                      {hasTarget ? "Remove" : "Add"}
                    </button>
                  )}
                  {list.keys.length > 0 && (
                    <button className="icon-button danger" onClick={() => onClearList(list.name)} type="button" aria-label="Clear list">
                      <Trash2 size={17} />
                    </button>
                  )}
                  <button className="icon-button danger" onClick={() => onDeleteList(list.name)} type="button" aria-label="Delete list">
                    <X size={17} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </Drawer>
  );
}

function DetailsPanel({ part, onAddToCart, onClose }) {
  if (!part) return null;

  return (
    <Drawer isOpen={Boolean(part)} onClose={onClose} title={part.material || "Part details"} subtitle={part.description || "-"}>
      <div className="detail-price">
        <span>MRP</span>
        <strong>{formatPrice(part.mrp)}</strong>
      </div>
      <div className="detail-grid">
        <Detail label="DNP" value={formatPrice(part.dnp)} />
        <Detail label="RTL" value={formatPrice(part.rtl)} />
        <Detail label="HSN" value={part.hsn || "-"} />
        <Detail label="GST" value={part.gst || "-"} />
        <Detail label="Cat 1" value={part.cat1 || "-"} />
        <Detail label="Cat 2" value={part.cat2 || "-"} />
      </div>
      <button className="wide-action" type="button" onClick={() => onAddToCart(part)}>
        <ShoppingCart size={18} />
        Add to cart
      </button>
    </Drawer>
  );
}

function AdminPanel({ catalog, isOpen, onClose, onImport, onReset }) {
  const [password, setPassword] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const unlock = (event) => {
    event.preventDefault();
    setIsUnlocked(password === ADMIN_PASSWORD);
    setMessage(password === ADMIN_PASSWORD ? "Admin unlocked." : "Wrong password.");
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setMessage("Importing price list...");
    try {
      const nextCatalog = await parseWorkbook(file);
      await onImport(nextCatalog, password);
      setMessage(`Imported ${nextCatalog.rowCount.toLocaleString("en-IN")} parts.`);
    } catch (error) {
      setMessage(error.message || "Import failed.");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  };

  return (
    <Drawer isOpen={isOpen} onClose={onClose} title="Admin upload" subtitle={catalog?.sourceFile || "Price list"}>
      {!isUnlocked ? (
        <form className="admin-lock" onSubmit={unlock}>
          <KeyRound size={34} />
          <label>
            Password
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter password"
              type="password"
              value={password}
            />
          </label>
          <button className="wide-action" type="submit">
            Unlock
          </button>
          {message && <p className="admin-message">{message}</p>}
        </form>
      ) : (
        <div className="admin-tools">
          <label className="upload-drop">
            <Upload size={28} />
            <span>{isImporting ? "Importing..." : "Upload Excel price list"}</span>
            <input accept=".xlsx,.xls" disabled={isImporting} onChange={importFile} type="file" />
          </label>
          {!API_BASE && (
            <button className="secondary-action" onClick={onReset} type="button">
              Use deployed catalog
            </button>
          )}
          {message && <p className="admin-message">{message}</p>}
        </div>
      )}
    </Drawer>
  );
}

function Drawer({ children, isOpen, onClose, title, subtitle }) {
  return (
    <>
      <button
        aria-label="Close drawer"
        className={`drawer-backdrop${isOpen ? " open" : ""}`}
        onClick={onClose}
        type="button"
      />
      <aside className={`drawer${isOpen ? " open" : ""}`}>
        <div className="drawer-header">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

function Detail({ label, value }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

