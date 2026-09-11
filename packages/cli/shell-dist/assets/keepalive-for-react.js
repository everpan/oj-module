var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../node_modules/.pnpm/keepalive-for-react@5.0.11_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/keepalive-for-react/dist/index.mjs
var dist_exports = {};
__export(dist_exports, {
  KeepAlive: () => je,
  useEffectOnActive: () => We,
  useEffectOnCreate: () => ot,
  useKeepAliveContext: () => b,
  useKeepAliveRef: () => le,
  useKeepaliveRef: () => Ir,
  useLayoutEffectOnActive: () => Ze,
  useLayoutEffectOnCreate: () => st
});
import * as S from "react";
import { createContext, memo, useMemo, Fragment as Fragment2, useRef, useLayoutEffect, useState, startTransition, useContext, useCallback, useImperativeHandle, useEffect } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { createPortal } from "react-dom";

// ../../node_modules/.pnpm/mitt@3.0.1/node_modules/mitt/dist/mitt.mjs
function mitt_default(n) {
  return { all: n = n || /* @__PURE__ */ new Map(), on: function(t, e) {
    var i = n.get(t);
    i ? i.push(e) : n.set(t, [e]);
  }, off: function(t, e) {
    var i = n.get(t);
    i && (e ? i.splice(i.indexOf(e) >>> 0, 1) : n.set(t, []));
  }, emit: function(t, e) {
    var i = n.get(t);
    i && i.slice().map(function(n2) {
      n2(e);
    }), (i = n.get("*")) && i.slice().map(function(n2) {
      n2(t, e);
    });
  } };
}

// ../../node_modules/.pnpm/keepalive-for-react@5.0.11_react-dom@19.2.8_react@19.2.8__react@19.2.8/node_modules/keepalive-for-react/dist/index.mjs
function P(e) {
  return e == null;
}
function _(e) {
  return Object.prototype.toString.call(e) === "[object RegExp]";
}
function M(e) {
  return Array.isArray(e);
}
function h(e) {
  return typeof e == "function";
}
function j(e) {
  return { set: (t, r) => (e.setAttribute(t, r), j(e)) };
}
function $(e = 100) {
  let t;
  return new Promise((r, i) => {
    t = setTimeout(() => {
      r(), P(t) || clearTimeout(t);
    }, e);
  });
}
function V(e, t) {
  return (M(e) ? e : P(e) ? [] : [e]).some((i) => _(i) ? i.test(t) : t === i);
}
function w(e) {
  setTimeout(e, 0);
}
var F = createContext({ active: false, _cacheKey: "", refresh: () => {
}, destroy: () => Promise.resolve(), destroyAll: () => Promise.resolve(), destroyOther: () => Promise.resolve(), getCacheNodes: () => [] });
var he = memo(function(e) {
  let { children: t, active: r, refresh: i, destroy: n, destroyAll: o, destroyOther: d, getCacheNodes: E, _cacheKey: m } = e, R = useMemo(() => ({ active: r, refresh: i, destroy: n, destroyAll: o, destroyOther: d, getCacheNodes: E, _cacheKey: m }), [r, i, n, o, d, E, m]);
  return jsx(F.Provider, { value: R, children: t });
});
var X = he;
var Y = S.Activity;
var Z = Y ?? S.Fragment;
var ee = !!Y;
function Ke({ children: e, active: t, duration: r }) {
  let [i, n] = useState(t), o = useRef(null);
  return useLayoutEffect(() => (t ? startTransition(() => {
    n(true);
  }) : (o.current && clearTimeout(o.current), o.current = setTimeout(() => {
    n(false), o.current && clearTimeout(o.current);
  }, r)), () => {
    o.current && clearTimeout(o.current);
  }), [t]), jsx(Z, { mode: i ? "visible" : "hidden", children: e });
}
var te = memo(Ke, (e, t) => e.active === t.active && e.duration === t.duration);
te.displayName = "MemoizedActivty";
var re = te;
var ce = "keepalive-cache-div";
function se(e) {
  return e ? Array.from(e.children) : [];
}
function J(e) {
  e.forEach((t) => {
    t.classList.contains(ce) && t.remove();
  });
}
function ne(e, t) {
  let r = se(e);
  J(r), e.appendChild(t), t.classList.remove("inactive"), t.classList.add("active");
}
function oe(e, t) {
  let i = se(e).filter((n) => n.classList.contains("active") && n.getAttribute("data-cache-key") !== t);
  return i.forEach((n) => {
    n.classList.remove("active"), n.classList.add("inactive");
  }), i;
}
function Me(e, t, r) {
  return r ? V(r, e) : t ? !V(t, e) : true;
}
var we = memo(function(e) {
  let { errorElement: t = Fragment2, cacheNodeClassName: r, children: i, cacheKey: n, exclude: o, include: d, enableActivity: E } = e, { active: m, renderCount: R, destroy: L, transition: I, viewTransition: z, duration: g, containerDivRef: O } = e, A = useRef(false);
  A.current = A.current || m;
  let x = useMemo(() => {
    let v = document.createElement("div");
    return j(v).set("data-cache-key", n).set("style", "height: 100%").set("data-render-count", R.toString()), v.className = ce + (r ? ` ${r}` : ""), v;
  }, [R, r]);
  return useLayoutEffect(() => {
    let v = Me(n, o, d), l = O.current;
    if (!l) {
      console.warn("keepalive: cache container not found");
      return;
    }
    if (I) (async () => {
      if (m) {
        let u = oe(l, n);
        if (await $(g - 40), J(u), l.contains(x)) return;
        ne(l, x);
      } else v || (await $(g), L(n));
    })();
    else if (m) {
      let u = () => {
        let D = oe(l, n);
        J(D), !l.contains(x) && ne(l, x);
      };
      z && document.startViewTransition ? document.startViewTransition(u) : u();
    } else v || L(n);
  }, [m, O, n, o, d]), A.current ? createPortal(jsx(t, { children: ee && E ? jsx(re, { active: m, duration: g, children: i }) : i }), x, n) : null;
}, (e, t) => e.active === t.active && e.renderCount === t.renderCount && e.children === t.children && e.exclude === t.exclude && e.include === t.include);
var ae = we;
var Fe = (e) => {
  typeof startTransition < "u" && h(startTransition) ? startTransition(e) : e();
};
var ue = Fe;
var ke = mitt_default();
var f = ke;
function le() {
  return useRef(null);
}
function _e(e) {
  let { activeCacheKey: t, max: r = 10, exclude: i, include: n, onBeforeActive: o, customContainerRef: d, cacheNodeClassName: E = "cache-component", containerClassName: m = "keep-alive-render", errorElement: R, transition: L = false, viewTransition: I = false, duration: z = 200, children: g, aliveRef: O, maxAliveTime: A = 0, enableActivity: x = false } = e, v = d || useRef(null), [l, u] = useState([]);
  useLayoutEffect(() => {
    P(t) || ue(() => {
      u((a) => {
        let s = Date.now();
        if (a.find((c) => c.cacheKey === t)) return a.map((c) => {
          if (c.cacheKey === t) {
            let y = false;
            if (h(o) && o(t), A) {
              let K = c.lastActiveTime;
              if (M(A)) {
                let C = A.find((N) => _(N.match) ? N.match.test(t) : N.match === t);
                C && (y = C && K + C.expire * 1e3 < s);
              } else y = K + A * 1e3 < s;
            }
            return y && f.emit("destroy", [t]), { ...c, ele: g, lastActiveTime: s, renderCount: y ? c.renderCount + 1 : c.renderCount };
          }
          return c;
        });
        if (h(o) && o(t), a.length > r) {
          let c = a.reduce((C, N) => C.lastActiveTime < N.lastActiveTime ? C : N), K = a.splice(a.indexOf(c), 1).map((C) => C.cacheKey);
          f.emit("destroy", K);
        }
        return [...a, { cacheKey: t, lastActiveTime: s, ele: g, renderCount: 0 }];
      });
    });
  }, [t, g]);
  let D = useCallback((a) => {
    u((s) => {
      let p = a || t;
      return f.emit("refresh", p), s.map((c) => c.cacheKey === p ? { ...c, renderCount: c.renderCount + 1 } : c);
    });
  }, [u, t]), B = useCallback((a) => {
    let s = a || t, p = M(s) ? s : [s];
    return f.emit("destroy", p), new Promise((c) => {
      w(() => {
        u((y) => [...y.filter((K) => !p.includes(K.cacheKey))]), c();
      });
    });
  }, [u, t]), G = useCallback(() => new Promise((a) => {
    f.emit("destroyAll"), w(() => {
      u([]), a();
    });
  }), [u]), Q = useCallback((a) => {
    let s = a || t;
    return new Promise((p) => {
      f.emit("destroyOther", s), w(() => {
        u((c) => [...c.filter((y) => y.cacheKey === s)]), p();
      });
    });
  }, [t, u]), W = useCallback(() => l, [l]);
  return useImperativeHandle(O, () => ({ refresh: D, destroy: B, destroyAll: G, destroyOther: Q, getCacheNodes: W })), jsxs(Fragment2, { children: [jsx("div", { ref: v, className: m, style: { height: "100%" } }), l.map((a) => {
    let { cacheKey: s, ele: p, renderCount: c } = a;
    return jsx(X, { active: t === s, refresh: D, destroy: B, destroyAll: G, destroyOther: Q, getCacheNodes: W, _cacheKey: s, children: jsx(ae, { destroy: B, include: n, exclude: i, transition: L, viewTransition: I, duration: z, renderCount: c, containerDivRef: v, errorElement: R, active: t === s, cacheNodeClassName: E, cacheKey: s, enableActivity: x, children: p }) }, `${s}-${c}`);
  })] });
}
var je = _e;
var Je = () => useContext(F);
var b = Je;
function qe(e, t, r = false, i) {
  let { active: n } = b(), o = useRef(false);
  i(() => {
    if (!n) return;
    if (r && !o.current) {
      o.current = true;
      return;
    }
    let d = e();
    return () => {
      h(d) && d();
    };
  }, [n, ...t]);
}
var k = qe;
var Qe = (e, t, r = false) => {
  k(e, t, r, useEffect);
};
var We = Qe;
var Ye = (e, t, r = false) => {
  k(e, t, r, useLayoutEffect);
};
var Ze = Ye;
function et(e, t) {
  f.on("destroy", (r) => {
    r.includes(t) && e();
  }), f.on("destroyAll", () => {
    e();
  }), f.on("destroyOther", (r) => {
    r !== t && e();
  }), f.on("refresh", (r) => {
    r === t && e();
  });
}
var de = et;
function tt(e, t) {
  let r = useRef(false), i = useRef(false), { _cacheKey: n } = b();
  t(() => {
    let o;
    r.current === false && (r.current = true, o = e()), de(() => {
      h(o) && !i.current && (i.current = true, o());
    }, n);
  }, []);
}
var H = tt;
var nt = (e) => {
  H(e, useEffect);
};
var ot = nt;
var ct = (e) => {
  H(e, useLayoutEffect);
};
var st = ct;
var Ir = le;

// shell/.ram-shim-keepalive-for-react.mjs
var ram_shim_keepalive_for_react_default = void 0 ?? dist_exports;
export {
  je as KeepAlive,
  ram_shim_keepalive_for_react_default as default,
  We as useEffectOnActive,
  ot as useEffectOnCreate,
  b as useKeepAliveContext,
  le as useKeepAliveRef,
  Ir as useKeepaliveRef,
  Ze as useLayoutEffectOnActive,
  st as useLayoutEffectOnCreate
};
