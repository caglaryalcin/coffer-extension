import { sax } from "./vendor/sax.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MAX_SOURCE_LENGTH = 512 * 1024;
const MAX_NODES = 4096;
const MAX_DEPTH = 64;
const TAGS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "use", "pattern",
]);
const DRAWING_TAGS = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use"]);
const LENGTH_ATTRIBUTES = new Set([
  "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr",
  "width", "height", "offset", "pathLength", "stroke-width", "stroke-dashoffset",
]);
const NUMBER_ATTRIBUTES = new Set([
  "opacity", "fill-opacity", "stroke-opacity", "stop-opacity", "stroke-miterlimit",
]);
const PAINT_ATTRIBUTES = new Set(["fill", "stroke", "color", "stop-color"]);
const TRANSFORM_ATTRIBUTES = new Set(["transform", "gradientTransform", "patternTransform"]);
const ENUM_ATTRIBUTES = new Map([
  ["fill-rule", ["nonzero", "evenodd", "inherit"]],
  ["clip-rule", ["nonzero", "evenodd", "inherit"]],
  ["stroke-linecap", ["butt", "round", "square", "inherit"]],
  ["stroke-linejoin", ["miter", "miter-clip", "round", "bevel", "arcs", "inherit"]],
  ["gradientUnits", ["userSpaceOnUse", "objectBoundingBox"]],
  ["clipPathUnits", ["userSpaceOnUse", "objectBoundingBox"]],
  ["maskUnits", ["userSpaceOnUse", "objectBoundingBox"]],
  ["maskContentUnits", ["userSpaceOnUse", "objectBoundingBox"]],
  ["patternUnits", ["userSpaceOnUse", "objectBoundingBox"]],
  ["patternContentUnits", ["userSpaceOnUse", "objectBoundingBox"]],
  ["spreadMethod", ["pad", "reflect", "repeat"]],
  ["vector-effect", ["none", "non-scaling-stroke"]],
  ["display", ["none", "inline", "inherit"]],
  ["visibility", ["visible", "hidden", "collapse", "inherit"]],
  ["shape-rendering", ["auto", "optimizeSpeed", "crispEdges", "geometricPrecision", "inherit"]],
  ["color-interpolation", ["auto", "sRGB", "linearRGB", "inherit"]],
  ["mask-type", ["luminance", "alpha"]],
]);
const STYLE_ATTRIBUTES = new Set([
  ...PAINT_ATTRIBUTES, ...NUMBER_ATTRIBUTES,
  "stroke-width", "stroke-dashoffset", "stroke-dasharray", "fill-rule", "clip-rule",
  "stroke-linecap", "stroke-linejoin", "clip-path", "mask", "vector-effect",
  "display", "visibility", "shape-rendering", "color-interpolation", "mask-type",
]);
const ID = /^[A-Za-z0-9_.:-]+$/;
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const LENGTH = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:%|px|pt|pc|mm|cm|in|em|ex)?$/i;
const NUMBER_LIST = /^[\d\s.,eE+-]+$/;
const LOCAL_URL = /^url\(\s*(['"]?)#([A-Za-z0-9_.:-]+)\1\s*\)$/i;

function sanitizeAttribute(name, input) {
  const value = input.trim();
  if (!value || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\\<>]/.test(value)) return null;
  if (name === "id") return ID.test(value) ? value : null;
  if (name === "href") return /^#[A-Za-z0-9_.:-]+$/.test(value) ? value : null;
  if (name === "clip-path" || name === "mask") {
    return value === "none" || LOCAL_URL.test(value) ? value : null;
  }
  if (PAINT_ATTRIBUTES.has(name)) {
    if (LOCAL_URL.test(value)) return value;
    if (/^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]+)$/i.test(value)) return value;
    return /^(?:rgba?|hsla?)\([\d\s.,%+/-]+\)$/i.test(value) ? value : null;
  }
  if (LENGTH_ATTRIBUTES.has(name)) return LENGTH.test(value) ? value : null;
  if (NUMBER_ATTRIBUTES.has(name)) return NUMBER.test(value) && Number.isFinite(Number(value)) ? value : null;
  if (name === "d") return /^[MmZzLlHhVvCcSsQqTtAa\d\s.,eE+-]+$/.test(value) ? value : null;
  if (name === "points") return NUMBER_LIST.test(value) ? value : null;
  if (name === "stroke-dasharray") {
    return value === "none" || /^[\d\s.,eE%+-]+$/.test(value) ? value : null;
  }
  if (name === "viewBox") {
    const numbers = value.split(/[\s,]+/);
    return numbers.length === 4 && numbers.every((item) => NUMBER.test(item) && Number.isFinite(Number(item)))
      && Number(numbers[2]) > 0 && Number(numbers[3]) > 0 ? numbers.join(" ") : null;
  }
  if (name === "preserveAspectRatio") {
    return /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?:\s+(?:meet|slice))?)$/.test(value) ? value : null;
  }
  if (TRANSFORM_ATTRIBUTES.has(name)) {
    return /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\s*\([\d\s.,eE+-]+\)\s*,?\s*)+$/.test(value) ? value : null;
  }
  return ENUM_ATTRIBUTES.get(name)?.includes(value) ? value : null;
}

function presentationStyle(source) {
  const attrs = {};
  for (const declaration of source.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator === -1) continue;
    const name = declaration.slice(0, separator).trim().toLowerCase();
    if (!STYLE_ATTRIBUTES.has(name)) continue;
    const value = sanitizeAttribute(name, declaration.slice(separator + 1).replace(/\s*!important\s*$/i, ""));
    if (value !== null) attrs[name] = value;
  }
  return attrs;
}

function classRules(source) {
  const rules = [];
  const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
  // Deliberately support only plain class selectors, never arbitrary page CSS.
  for (const match of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((selector) => selector.trim());
    if (!selectors.every((selector) => /^\.[A-Za-z_][A-Za-z0-9_-]*$/.test(selector))) continue;
    rules.push({ classes: selectors.map((selector) => selector.slice(1)), attrs: presentationStyle(match[2]) });
  }
  return rules;
}

function rewriteReferences(root, nodes) {
  const ids = new Map();
  for (const node of nodes) {
    if (!node.attrs.id) continue;
    if (ids.has(node.attrs.id)) return false;
    ids.set(node.attrs.id, { node, replacement: `logo-ref-${ids.size + 1}` });
  }
  const edges = new Map(nodes.map((node) => [node, [...node.children]]));
  for (const node of nodes) {
    for (const [name, value] of Object.entries(node.attrs)) {
      if (name === "id") {
        node.attrs.id = ids.get(value).replacement;
        continue;
      }
      const match = LOCAL_URL.exec(value);
      if (name !== "href" && !match) continue;
      const target = ids.get(name === "href" ? value.slice(1) : match[2]);
      let allowed = Boolean(target);
      if (allowed && name === "href") {
        allowed = node.tag === "use"
          ? ["svg", "g", ...DRAWING_TAGS].includes(target.node.tag)
          : ["linearGradient", "radialGradient", "pattern"].includes(node.tag)
            && ["linearGradient", "radialGradient", "pattern"].includes(target.node.tag);
      } else if (allowed) {
        const targets = name === "clip-path" ? ["clipPath"] : name === "mask" ? ["mask"]
          : name === "fill" || name === "stroke" ? ["linearGradient", "radialGradient", "pattern"] : [];
        allowed = targets.includes(target.node.tag);
      }
      if (!allowed) {
        delete node.attrs[name];
        continue;
      }
      node.attrs[name] = name === "href" ? `#${target.replacement}` : `url(#${target.replacement})`;
      edges.get(node).push(target.node);
    }
  }

  // Local references must also be bounded: small <use> graphs can expand exponentially.
  const active = new Set();
  const costs = new Map();
  function cost(node, depth) {
    if (depth > MAX_DEPTH || active.has(node)) throw new Error("Recursive SVG reference");
    if (costs.has(node)) return costs.get(node);
    active.add(node);
    let total = 1;
    for (const child of edges.get(node)) {
      total += cost(child, depth + 1);
      if (total > MAX_NODES * 4) throw new Error("SVG reference expansion limit");
    }
    active.delete(node);
    costs.set(node, total);
    return total;
  }
  cost(root, 1);
  return true;
}

/** Return inert SVG geometry for createElementNS rendering; never return markup or page CSS. */
export function parseSvgLogo(source) {
  if (typeof source !== "string" || !source.trim() || source.length > MAX_SOURCE_LENGTH) return null;
  let root = null;
  let count = 0;
  const stack = [];
  const nodes = [];
  const styles = [];
  const metadata = new Map();
  const parser = sax.parser(true, { xmlns: true, strictEntities: true });
  parser.onerror = () => { throw new Error("Invalid SVG XML"); };
  parser.ondoctype = () => { throw new Error("SVG doctypes are not supported"); };
  parser.onsgmldeclaration = () => { throw new Error("SVG declarations are not supported"); };
  parser.onopentag = (element) => {
    if (++count > MAX_NODES || stack.length >= MAX_DEPTH) throw new Error("SVG size limit");
    const parent = stack.at(-1);
    const validNamespace = !element.prefix && (!element.uri || element.uri === SVG_NAMESPACE);
    if (!parent && (root || element.name !== "svg" || !validNamespace)) throw new Error("Invalid SVG root");
    if ((parent && !parent.node) || !validNamespace) {
      stack.push({ node: null });
      return;
    }
    if (element.name === "style") {
      const style = { text: "" };
      styles.push(style);
      stack.push({ node: null, style });
      return;
    }
    // Brand exports sometimes wrap their single drawing in an SVG switch.
    const tag = element.name === "switch" ? "g" : element.name;
    if (!TAGS.has(tag)) {
      stack.push({ node: null });
      return;
    }
    const node = { tag, attrs: {}, children: [] };
    const meta = { classes: [], inlineStyle: "" };
    for (const attribute of Object.values(element.attributes)) {
      let name = attribute.name;
      if (name === "class") {
        meta.classes = attribute.value.trim().split(/\s+/);
        continue;
      }
      if (name === "style") {
        meta.inlineStyle = attribute.value;
        continue;
      }
      if (name === "xlink:href" && attribute.uri === "http://www.w3.org/1999/xlink") name = "href";
      else if (attribute.prefix) continue;
      const value = sanitizeAttribute(name, attribute.value);
      if (value !== null) node.attrs[name] = value;
    }
    nodes.push(node);
    metadata.set(node, meta);
    if (parent) parent.node.children.push(node);
    else root = node;
    stack.push({ node });
  };
  parser.onclosetag = () => { stack.pop(); };
  parser.ontext = parser.oncdata = (text) => {
    const entry = stack.at(-1);
    if (entry?.style) entry.style.text += text;
  };
  try {
    parser.write(source).close();
    if (!root || stack.length || !nodes.some((node) => DRAWING_TAGS.has(node.tag))) return null;
    const rules = styles.flatMap((style) => classRules(style.text));
    for (const node of nodes) {
      const meta = metadata.get(node);
      for (const rule of rules) {
        if (rule.classes.some((name) => meta.classes.includes(name))) Object.assign(node.attrs, rule.attrs);
      }
      Object.assign(node.attrs, presentationStyle(meta.inlineStyle));
    }
    if (!root.attrs.viewBox) {
      const width = root.attrs.width?.replace(/px$/i, "");
      const height = root.attrs.height?.replace(/px$/i, "");
      if (width && height && NUMBER.test(width) && NUMBER.test(height) && Number(width) > 0 && Number(height) > 0
        && Number.isFinite(Number(width)) && Number.isFinite(Number(height))) {
        root.attrs.viewBox = `0 0 ${Number(width)} ${Number(height)}`;
      }
    }
    return rewriteReferences(root, nodes) ? root : null;
  } catch {
    return null;
  }
}
