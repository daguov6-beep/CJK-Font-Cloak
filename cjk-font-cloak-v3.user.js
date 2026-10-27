// ==UserScript==
// @name         CJK Font & Locale Cloak
// @name:zh-CN   中文环境伪装 v3
// @namespace    https://local.fontcloak/v3
// @version      3.0.0
// @description  Hide CJK fonts, Chinese locale and Chinese language signals from front-end fingerprinting. Network layer untouched by design.
// @description:zh-CN  前端指纹层的中文环境伪装：字体 / 语言 / Intl 默认区域 / WebRTC。刻意不碰任何网络层数据。
// @author       local
// @license      MIT
// @homepageURL  https://example.invalid/cjk-font-cloak
// @supportURL   https://example.invalid/cjk-font-cloak/issues
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/*
 * 与 v2.3.0 的差异（v3 重写）：
 *   1. 修掉 toString 泄漏：v2 只把 measureText / check / queryLocalFonts 放进了白名单，
 *      navigator.languages / userAgent / platform 等 getter 没进，一行
 *      Object.getOwnPropertyDescriptor(Navigator.prototype,'languages').get.toString() 就能打出源码。
 *      v3 用统一注册表，所有被改的函数与访问器都登记伪造源码。
 *   2. 补上 Intl 默认区域：v2 只改 navigator.language，但 Intl.DateTimeFormat().resolvedOptions().locale
 *      和 Date.prototype.toLocaleString() 仍取浏览器 UI 语言 —— 这是 v2 最大的一处自相矛盾。
 *   3. RTCPeerConnection 改用 Proxy：v2 用 function 包装并覆盖 prototype，pc.constructor 仍指向原生、
 *      RTCPeerConnection.name 变成 "CloakedPC"，两个字节级破绽。
 *   4. 补 OffscreenCanvas 的 measureText（大量检测库用它，v2 漏了）。
 *   5. document.fonts.check 改打 FontFaceSet.prototype，v2 打在实例上，hasOwnProperty 一查就露。
 *   6. 补 WebGL vendor/renderer（仅当 profile 开启时），否则「UA 说 Linux、WebGL 说 Direct3D11」自相矛盾。
 *   7. 时区可配（默认关），基于 IANA 名计算真实偏移，含 DST。
 *   8. 内置自检：控制台运行 __cloakReport()，直接看「检测方看到什么」和「哪里还自相矛盾」。
 *
 * ⚠ 能力边界（写在代码里，也请转告使用者）：
 *   - 用户脚本只能改页面 JS 读到的值。HTTP 请求头（User-Agent / Sec-CH-UA-Platform / Accept-Language）
 *     在你的脚本运行前就已发出，脚本无权修改；TLS 指纹（JA3/JA4）在更下层；出口 IP 在服务端。
 *   - 因此对做服务端交叉校验的系统，本脚本不提供任何保护。它不是匿名工具。
 */

(function () {
  'use strict';

  /* ============================ 配置区 ============================ */

  const CFG = {
    // 语言
    language: 'en-US',
    languages: ['en-US', 'en'],

    // 时区：'' = 不改（推荐，直接用系统时区）；填 IANA 名则本脚本在 JS 层伪装，含 DST。
    // 注意：伪装时区必须与出口 IP 所在地区一致，否则是比不伪装更强的信号。
    timezone: '',

    // 平台画像：'' = 不改（推荐）；'win' | 'mac' | 'linux'
    // 开启后会同时改 UA / platform / userAgentData / WebGL，保证内部一致。
    // 但无论怎么改，HTTP 头里的 Sec-CH-UA-Platform 仍是真实值 —— 请不要在线下当真。
    profile: '',

    // 实验性：用 @font-face 屏蔽本地 CJK 字体名的 DOM 探测（span 测宽那一套）。
    // 代价：页面上的中文会回退到后备字体渲染，且会多注入一个 <style> 节点。
    domFontProbe: false,

    // '' = 不改；填 'en-US' 会改写 <html lang>
    documentLang: '',

    // 是否暴露 __cloakReport() 自检函数
    report: true,

    // 按站点生效
    hosts: {
      font: /.*/,
      locale: /.*/,
      rtc: /(^|\.)(browserleaks\.com|ipleak\.net|whoer\.net|ipcheck\.ing|cleanip\.io|ippure\.com|toolshu\.com)$/i,
      profile: /.*/
    }
  };

  /* ============================ 基础设施 ============================ */

  const HOST = (function () {
    try { return location.hostname; } catch (e) { return ''; }
  })();

  const ON = {
    font: !!CFG.hosts.font && CFG.hosts.font.test(HOST),
    locale: !!CFG.hosts.locale && CFG.hosts.locale.test(HOST),
    rtc: !!CFG.hosts.rtc && CFG.hosts.rtc.test(HOST),
    profile: !!CFG.profile && !!CFG.hosts.profile && CFG.hosts.profile.test(HOST)
  };

  // 原生实现全部先抓走，后面只经由这里调用，避免自己改到自己。
  const N = {
    toString: Function.prototype.toString,
    measureText: window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype.measureText,
    offMeasureText: window.OffscreenCanvasRenderingContext2D && OffscreenCanvasRenderingContext2D.prototype.measureText,
    fontsCheck: window.FontFaceSet && FontFaceSet.prototype.check,
    resolvedOptions: window.Intl && Intl.DateTimeFormat && Intl.DateTimeFormat.prototype.resolvedOptions,
    getTimezoneOffset: Date.prototype.getTimezoneOffset,
    dateToString: Date.prototype.toString,
    dateTimeString: Date.prototype.toTimeString,
    dateToLocaleString: Date.prototype.toLocaleString,
    dateToLocaleDateString: Date.prototype.toLocaleDateString,
    dateToLocaleTimeString: Date.prototype.toLocaleTimeString,
    numberToLocaleString: Number.prototype.toLocaleString,
    Intl: window.Intl ? {
      DateTimeFormat: Intl.DateTimeFormat,
      NumberFormat: Intl.NumberFormat,
      Collator: Intl.Collator,
      PluralRules: Intl.PluralRules,
      RelativeTimeFormat: Intl.RelativeTimeFormat,
      ListFormat: Intl.ListFormat,
      DisplayNames: Intl.DisplayNames,
      Segmenter: Intl.Segmenter
    } : null
  };

  // 被改造过的函数 -> 应对外声明的源码。检测方查不到这张表（闭包内）。
  const FAKE_SOURCE = new WeakMap();

  function markNative(fn, name) {
    if (typeof fn !== 'function') return fn;
    try {
      FAKE_SOURCE.set(fn, 'function ' + (name || fn.name || '') + '() { [native code] }');
    } catch (e) {}
    return fn;
  }

  try {
    const patchedToString = function toString() {
      const fake = FAKE_SOURCE.get(this);
      if (fake !== undefined) return fake;
      return N.toString.call(this);
    };
    markNative(patchedToString, 'toString');
    Function.prototype.toString = patchedToString;
  } catch (e) {}

  // 让访问器函数的 name 变成 'get languages'。
  // 注意：defineProperty({get: fn}) 不会自动合成这个名字（只有对象字面量的 get 语法才会），
  // 所以必须手工改名，否则 get.name === '' 就是一处现成的破绽。
  function accessor(name, fn) {
    try {
      Object.defineProperty(fn, 'name', { value: 'get ' + name, configurable: true });
    } catch (e) {}
    return markNative(fn, 'get ' + name);
  }

  function defineGetter(proto, prop, fn) {
    try {
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      const getter = accessor(prop, fn);
      if (!getter) return false;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc ? desc.enumerable : true,
        get: getter
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  function defineMethod(proto, prop, fn) {
    try {
      // WebIDL 的接口方法在原型上是 enumerable: true。写死 false 会让
      // for...in / Object.keys(Navigator.prototype) 当场发现异常，所以照抄原描述符。
      const d = Object.getOwnPropertyDescriptor(proto, prop);
      markNative(fn, prop);
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: d ? d.enumerable : true,
        writable: true,
        value: fn
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ============================ 1. 字体 ============================ */

  const CJK = /yahei|msyh|simsun|nsimsun|simhei|simkai|simfang|dengxian|fangsong|kaiti|pingfang|hiragino|heiti|songti|stheiti|stkaiti|stsong|stfangsong|libian|youyuan|mingliu|pmingliu|jhenghei|wenquanyi|micro\s*hei|source\s*han|noto\s*(sans|serif)\s*(sc|tc|cjk|hans|hant)|misans|harmonyos|honor\s*sans|oppo\s*sans|vivo\s*sans|huawei\s*sans|alibaba|puhuiti|fz[\w-]*lanting|lxgw|smiley\s*sans|sarasa|maple|source\s*code\s*pro|noto\s*sans\s*mono\s*cjk|\bwps\b|founder|雅黑|苹方|黑体|宋体|楷体|仿宋|幼圆|隶书|思源|华文|等线|正黑|细明|方正|兰亭|普惠|荣耀|文泉驿/i;

  function stripCJK(font) {
    const m = /^([\s\S]*?\d+(?:\.\d+)?(?:px|pt|pc|em|rem|%|ex|ch|in|cm|mm|q))(\s*\/\s*[^\s,]+)?\s+([\s\S]+)$/i.exec(font);
    if (!m) return null;
    let families = m[3].split(',').map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !CJK.test(s); });
    if (!families.length) families = ['serif'];
    return m[1] + (m[2] || '') + ' ' + families.join(', ');
  }

  let scratchCtx = null;
  function scratch() {
    if (scratchCtx !== null) return scratchCtx;
    try {
      const c = document.createElement('canvas');
      c.width = 1; c.height = 1;
      scratchCtx = c.getContext('2d');
    } catch (e) { scratchCtx = undefined; }
    return scratchCtx;
  }

  // 关键改进：不再临时改 this.font（会被现场 getter 抓到），改用离屏 2D 上下文测量。
  function makeMeasureText(orig) {
    const fn = function measureText(text) {
      let font;
      try { font = this.font; } catch (e) { font = null; }
      if (typeof font === 'string' && CJK.test(font)) {
        const stripped = stripCJK(font);
        const ctx = stripped && scratch();
        if (ctx) {
          try {
            ctx.font = stripped;
            return orig.call(ctx, text);
          } catch (e) {}
        }
      }
      return orig.call(this, text);
    };
    return fn;
  }

  if (ON.font) {
    try {
      if (N.measureText) {
        defineMethod(CanvasRenderingContext2D.prototype, 'measureText', makeMeasureText(N.measureText));
      }
    } catch (e) {}

    try {
      if (N.offMeasureText) {
        defineMethod(OffscreenCanvasRenderingContext2D.prototype, 'measureText', makeMeasureText(N.offMeasureText));
      }
    } catch (e) {}

    try {
      if (N.fontsCheck) {
        // 打在原型上，不是实例上 —— v2 的写法 hasOwnProperty 一查就露。
        defineMethod(FontFaceSet.prototype, 'check', function check(font, text) {
          if (CJK.test(String(font))) return false;
          return N.fontsCheck.call(this, font, text);
        });
      }
    } catch (e) {}

    try {
      // 只在原生存在时才覆盖，否则凭空多出一个 API 本身就是指纹。
      if (typeof Navigator.prototype.queryLocalFonts === 'function' ||
          (window.LocalFontAccess && Navigator.prototype.hasOwnProperty('queryLocalFonts'))) {
        defineMethod(Navigator.prototype, 'queryLocalFonts', function queryLocalFonts() {
          return Promise.resolve([]);
        });
      }
    } catch (e) {}

    if (CFG.domFontProbe) {
      try {
        const names = CJK.source.match(/[a-z]{4,}(?:\\s\*[a-z]+)?/gi) || [];
        const css = names.map(function (n) {
          const family = n.replace(/\\s\*/g, ' ').replace(/-/g, ' ');
          return '@font-face{font-family:"' + family + '";src:local("__absent_' + family + '__")}';
        }).join('');
        const style = document.createElement('style');
        style.setAttribute('data-x', 'f');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      } catch (e) {}
    }
  }

  /* ============================ 2. 语言 + Intl 默认区域 ============================ */

  if (ON.locale) {
    try {
      defineGetter(Navigator.prototype, 'languages', function () { return CFG.languages.slice(); });
      defineGetter(Navigator.prototype, 'language', function () { return CFG.language; });
    } catch (e) {}

    // Intl 的默认区域取的是浏览器 UI 语言，跟 navigator.language 无关。
    // 不动这里，就是「navigator 说 en-US、Intl 说 zh-CN」当场自相矛盾。
    try {
      if (N.Intl) {
        Object.keys(N.Intl).forEach(function (key) {
          const Ctor = N.Intl[key];
          if (typeof Ctor !== 'function') return;
          const wrap = new Proxy(Ctor, {
            construct: function (target, args, newTarget) {
              const a = args.slice();
              if (a.length === 0 || a[0] === undefined) a[0] = CFG.language;
              return Reflect.construct(target, a, newTarget === wrap ? target : newTarget);
            },
            apply: function (target, thisArg, args) {
              const a = args.slice();
              if (a.length === 0 || a[0] === undefined) a[0] = CFG.language;
              return Reflect.apply(target, thisArg, a);
            }
          });
          // Proxy 的 toString 会退化成 "function () { [native code] }"，补一个正确的名字。
          markNative(wrap, key);
          try { Intl[key] = wrap; } catch (e) {}
        });
      }
    } catch (e) {}

    try {
      if (N.numberToLocaleString) {
        defineMethod(Number.prototype, 'toLocaleString', function toLocaleString(locales, options) {
          return N.numberToLocaleString.call(this, locales === undefined ? CFG.language : locales, options);
        });
      }
    } catch (e) {}

    try {
      if (N.dateToLocaleString) {
        defineMethod(Date.prototype, 'toLocaleString', function toLocaleString(locales, options) {
          return N.dateToLocaleString.call(this, locales === undefined ? CFG.language : locales, options);
        });
      }
      if (N.dateToLocaleDateString) {
        defineMethod(Date.prototype, 'toLocaleDateString', function toLocaleDateString(locales, options) {
          return N.dateToLocaleDateString.call(this, locales === undefined ? CFG.language : locales, options);
        });
      }
      if (N.dateToLocaleTimeString) {
        defineMethod(Date.prototype, 'toLocaleTimeString', function toLocaleTimeString(locales, options) {
          return N.dateToLocaleTimeString.call(this, locales === undefined ? CFG.language : locales, options);
        });
      }
    } catch (e) {}

    if (CFG.documentLang) {
      try {
        const setLang = function () {
          const el = document.documentElement;
          if (el) el.lang = CFG.documentLang;
        };
        setLang();
        new MutationObserver(setLang).observe(document.documentElement, { attributeFilter: ['lang'] });
      } catch (e) {}
    }
  }

  /* ============================ 3. 时区（默认关） ============================ */

  let tzState = null;

  if (CFG.timezone) {
    try {
      const NativeDTF = N.Intl.DateTimeFormat;
      const partsFmt = new NativeDTF('en-US', {
        timeZone: CFG.timezone, hourCycle: 'h23',
        year: 'numeric', month: 'short', day: '2-digit',
        weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
      const nameFmt = new NativeDTF('en-US', { timeZone: CFG.timezone, timeZoneName: 'long' });

      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      const monthIndex = function (m) {
        const i = MONTHS.indexOf(m);
        return i < 0 ? 0 : i;
      };

      const tzParts = function (d) {
        const out = {};
        partsFmt.formatToParts(d).forEach(function (p) { out[p.type] = p.value; });
        return out;
      };

      // 把目标时区的「墙上时间」当成 UTC 求值，与真实时间戳相减，得到该时刻的东向偏移。
      // 因为每次都按具体日期计算，DST 切换自然会跟上。
      const offsetEast = function (d) {
        const p = tzParts(d);
        const asUTC = Date.UTC(+p.year, monthIndex(p.month), +p.day, +p.hour, +p.minute, +p.second);
        return Math.round((asUTC - Math.floor(d.getTime() / 1000) * 1000) / 60000);
      };

      const pad = function (n) { return (n < 10 ? '0' : '') + n; };

      const gmt = function (d) {
        const east = offsetEast(d);
        const sign = east >= 0 ? '+' : '-';
        const abs = Math.abs(east);
        return 'GMT' + sign + pad(Math.floor(abs / 60)) + pad(abs % 60);
      };

      const longName = function (d) {
        const p = nameFmt.formatToParts(d).filter(function (x) { return x.type === 'timeZoneName'; })[0];
        return p ? p.value : '';
      };

      const clock = function (d) {
        const p = tzParts(d);
        return p.hour + ':' + p.minute + ':' + p.second;
      };

      tzState = { tzParts: tzParts, offsetEast: offsetEast, gmt: gmt, longName: longName, clock: clock };

      defineMethod(Date.prototype, 'getTimezoneOffset', function getTimezoneOffset() {
        return -offsetEast(this);
      });

      defineMethod(Date.prototype, 'toString', function toString() {
        try {
          const p = tzParts(this);
          return p.weekday + ' ' + p.month + ' ' + p.day + ' ' + p.year + ' ' +
            clock(this) + ' ' + gmt(this) + ' (' + longName(this) + ')';
        } catch (e) {
          return N.dateToString.call(this);
        }
      });

      defineMethod(Date.prototype, 'toTimeString', function toTimeString() {
        try {
          return clock(this) + ' ' + gmt(this) + ' (' + longName(this) + ')';
        } catch (e) {
          return N.dateTimeString.call(this);
        }
      });

      try {
        if (N.resolvedOptions) {
          defineMethod(Intl.DateTimeFormat.prototype, 'resolvedOptions', function resolvedOptions() {
            const out = N.resolvedOptions.call(this);
            try { out.timeZone = CFG.timezone; } catch (e) {}
            return out;
          });
        }
      } catch (e) {}
    } catch (e) {
      tzState = null;
    }
  }

  /* ============================ 4. 平台画像（默认关） ============================ */

  const PROFILES = (function () {
    let major = '155';
    const m = /\bChrome\/(\d+)/.exec(navigator.userAgent || '');
    if (m) major = m[1];

    const ua = function (tail) {
      return 'Mozilla/5.0 (' + tail + ') AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + major + '.0.0.0 Safari/537.36';
    };

    return {
      win: {
        ua: ua('Windows NT 10.0; Win64; x64'),
        platform: 'Win32',
        uaPlatform: 'Windows',
        getHighEntropy: { platform: 'Windows', platformVersion: '15.0.0', architecture: 'x86', bitness: '64', wow64: false },
        glVendor: 'Google Inc. (Intel)',
        glRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'
      },
      mac: {
        ua: ua('Macintosh; Intel Mac OS X 10_15_7'),
        platform: 'MacIntel',
        uaPlatform: 'macOS',
        getHighEntropy: { platform: 'macOS', platformVersion: '15.6.0', architecture: 'x86', bitness: '64', wow64: false },
        glVendor: 'Google Inc. (Intel)',
        glRenderer: 'ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics OpenGL Engine, OpenGL 4.1)'
      },
      linux: {
        ua: ua('X11; Linux x86_64'),
        platform: 'Linux x86_64',
        uaPlatform: 'Linux',
        getHighEntropy: { platform: 'Linux', platformVersion: '6.8.0', architecture: 'x86', bitness: '64', wow64: false },
        glVendor: 'Intel Open Source Technology Center',
        glRenderer: 'Mesa Intel(R) UHD Graphics 620 (KBL GT2)'
      }
    };
  })();

  const PROFILE = ON.profile ? PROFILES[CFG.profile] || null : null;

  if (PROFILE) {
    try {
      defineGetter(Navigator.prototype, 'userAgent', function () { return PROFILE.ua; });
      defineGetter(Navigator.prototype, 'appVersion', function () { return PROFILE.ua.replace('Mozilla/', ''); });
      defineGetter(Navigator.prototype, 'platform', function () { return PROFILE.platform; });
    } catch (e) {}

    try {
      if (window.NavigatorUAData && NavigatorUAData.prototype) {
        defineGetter(NavigatorUAData.prototype, 'platform', function () { return PROFILE.uaPlatform; });
        const origGEH = NavigatorUAData.prototype.getHighEntropyValues;
        if (typeof origGEH === 'function') {
          defineMethod(NavigatorUAData.prototype, 'getHighEntropyValues', function getHighEntropyValues(hints) {
            return origGEH.call(this, hints).then(function (v) {
              const out = Object.assign({}, v);
              Object.keys(PROFILE.getHighEntropy).forEach(function (k) {
                if (out[k] !== undefined) out[k] = PROFILE.getHighEntropy[k];
              });
              return out;
            });
          });
        }
      }
    } catch (e) {}

    // UA 说 Linux、WebGL 说 Direct3D11 = 当场穿帮。要么一起改，要么都别改。
    try {
      const patchGL = function (Proto) {
        if (!Proto || typeof Proto.getParameter !== 'function') return;
        const orig = Proto.getParameter;
        defineMethod(Proto, 'getParameter', function getParameter(p) {
          if (p === 37445) return PROFILE.glVendor;
          if (p === 37446) return PROFILE.glRenderer;
          return orig.call(this, p);
        });
      };
      patchGL(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
      patchGL(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
    } catch (e) {}
  }

  /* ============================ 5. WebRTC ============================ */

  if (ON.rtc) {
    try {
      const NativePC = window.RTCPeerConnection;
      if (typeof NativePC === 'function') {
        const cloaked = new Proxy(NativePC, {
          construct: function (target, args, newTarget) {
            const copy = Object.assign({}, args[0] || {});
            copy.iceServers = [];
            return Reflect.construct(target, [copy], newTarget === cloaked ? target : newTarget);
          },
          apply: function (target, thisArg, args) {
            const copy = Object.assign({}, args[0] || {});
            copy.iceServers = [];
            return Reflect.construct(target, [copy], target);
          }
        });
        // Proxy 直通 target 的 name / length / prototype，
        // 所以 constructor、instanceof、.name 全部保持原生，没有 v2 那三处破绽。
        // 只有 toString 需要补名字（Proxy 会丢失函数名）。
        markNative(cloaked, 'RTCPeerConnection');
        window.RTCPeerConnection = cloaked;
        if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = cloaked;
      }
    } catch (e) {}
  }

  /* ============================ 6. 自检 ============================ */

  function glInfo() {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (!ext) return null;
      return {
        vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      };
    } catch (e) { return null; }
  }

  function domFontProbe(name, fallback) {
    try {
      const base = document.createElement('span');
      base.style.cssText = 'position:absolute;left:-9999px;font-size:72px;white-space:nowrap;';
      base.textContent = '中文测试ABC';
      base.style.fontFamily = fallback;
      document.body.appendChild(base);
      const w0 = base.offsetWidth;
      base.style.fontFamily = '"' + name + '",' + fallback;
      const w1 = base.offsetWidth;
      base.remove();
      return w1 !== w0;
    } catch (e) { return null; }
  }

  function report() {
    const desc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
    let leak = 'n/a';
    try {
      leak = desc && desc.get ? Function.prototype.toString.call(desc.get) : 'n/a';
    } catch (e) { leak = 'error'; }

    let intlLocale = 'n/a';
    try { intlLocale = Intl.DateTimeFormat().resolvedOptions().locale; } catch (e) {}

    const out = {
      version: VERSION,
      host: HOST,
      enabled: ON,
      config: { language: CFG.language, languages: CFG.languages, timezone: CFG.timezone, profile: CFG.profile },
      navigator: {
        language: navigator.language,
        languages: (navigator.languages || []).slice(),
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        uaDataPlatform: navigator.userAgentData ? navigator.userAgentData.platform : 'n/a'
      },
      intl: {
        defaultLocale: intlLocale,
        timeZone: (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return 'n/a'; } })(),
        offsetMinutes: (function () { try { return -new Date().getTimezoneOffset(); } catch (e) { return 'n/a'; } })()
      },
      dateString: (function () { try { return new Date().toString(); } catch (e) { return 'n/a'; } })(),
      fonts: {
        checkYaHei: (function () { try { return document.fonts.check('12px "Microsoft YaHei"'); } catch (e) { return 'n/a'; } })(),
        checkArial: (function () { try { return document.fonts.check('12px Arial'); } catch (e) { return 'n/a'; } })(),
        domProbeYaHei: domFontProbe('Microsoft YaHei', 'monospace'),
        domProbePingFang: domFontProbe('PingFang SC', 'monospace')
      },
      webgl: glInfo(),
      rtcName: (function () { try { return RTCPeerConnection.name; } catch (e) { return 'n/a'; } })(),
      toStringLeak: leak
    };

    // 一致性检查 —— 伪装最容易死在「自己跟自己矛盾」上
    const issues = [];
    if (navigator.language !== (navigator.languages || [])[0]) {
      issues.push('navigator.language 与 languages[0] 不一致');
    }
    if (String(intlLocale).split('-')[0] !== String(navigator.language).split('-')[0]) {
      issues.push('Intl 默认区域 (' + intlLocale + ') 与 navigator.language (' + navigator.language + ') 不一致');
    }
    if (out.fonts.checkYaHei === true) {
      issues.push('document.fonts.check 仍报告微软雅黑存在');
    }
    if (out.fonts.domProbeYaHei === true) {
      issues.push('DOM 测宽仍能探测到微软雅黑（domFontProbe 未开启或未生效）');
    }
    if (/Linux/i.test(navigator.userAgent) && /Win/i.test(navigator.platform)) {
      issues.push('UA 说 Linux，platform 说 Windows');
    }
    if (/Linux/i.test(navigator.userAgent) && out.webgl && /Direct3D|D3D11/i.test(String(out.webgl.renderer))) {
      issues.push('UA 说 Linux，WebGL renderer 却是 Direct3D —— 这是最容易被抓的矛盾');
    }
    if (!/\[native code\]/.test(String(leak))) {
      issues.push('toString 泄漏：访问器源码可被读出');
    }
    if (CFG.timezone) {
      const want = (function () {
        try {
          return new (N.Intl.DateTimeFormat)('en-US', { timeZone: CFG.timezone }).resolvedOptions().timeZone;
        } catch (e) { return CFG.timezone; }
      })();
      const got = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ''; } })();
      if (got !== want) issues.push('时区伪装未生效：期望 ' + want + '，实际 ' + got);
    }
    out.issues = issues;

    try {
      console.group('%c Cloak report v' + VERSION, 'font-weight:600');
      console.table(out.navigator);
      console.log('Intl / 时区', out.intl);
      console.log('Date.toString', out.dateString);
      console.log('字体', out.fonts);
      console.log('WebGL', out.webgl);
      console.log('RTCPeerConnection.name', out.rtcName);
      console.log('访问器源码', out.toStringLeak);
      if (issues.length) {
        console.warn('仍有矛盾：\n - ' + issues.join('\n - '));
      } else {
        console.log('前端层未发现自相矛盾。注意：这不代表服务端也看不出来。');
      }
      console.groupEnd();
    } catch (e) {}

    return out;
  }

  if (CFG.report) {
    try {
      Object.defineProperty(window, '__cloakReport', {
        configurable: true,
        writable: true,
        value: report
      });
    } catch (e) {}
  }
})();
