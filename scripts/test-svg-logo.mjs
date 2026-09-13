import assert from "node:assert/strict";

function flatten(node) {
  return [node, ...node.children.flatMap(flatten)];
}

for (const browser of ["chrome", "firefox"]) {
  const { parseSvgLogo } = await import(`../${browser}/svg-logo.js`);
  // Representative Coffer Microsoft brand SVG, including root-level inherited fill.
  const microsoft = parseSvgLogo(`<?xml version="1.0" encoding="utf-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="#fff" role="img">
      <!-- Microsoft brand path -->
      <path d="M0 32l214.6 0 0 214.6-214.6 0 0-214.6zm233.4 0l214.6 0 0 214.6-214.6 0 0-214.6zM0 265.4l214.6 0 0 214.6-214.6 0 0-214.6zm233.4 0l214.6 0 0 214.6-214.6 0 0-214.6z"/>
    </svg>`);
  assert.ok(microsoft, `${browser}: Microsoft SVG must parse without browser DOM APIs`);
  assert.equal(microsoft.tag, "svg");
  assert.equal(microsoft.attrs.viewBox, "0 0 448 512");
  assert.equal(microsoft.attrs.fill, "#fff");
  assert.equal(microsoft.children[0].tag, "path");
  const switched = parseSvgLogo('<svg viewBox="0 0 512 512"><switch><g><path d="M0 0h10v10z"/></g></switch></svg>');
  assert.equal(switched.children[0].tag, "g", `${browser}: exported switch wrappers retain their geometry`);
  assert.equal(switched.children[0].children[0].children[0].tag, "path");

  const styled = parseSvgLogo(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
      width="100px" height="80" style="fill:#fff;position:fixed" onload="alert(1)">
    <style><![CDATA[.one,.two { fill: #123456; stroke:#fff } .two {fill:url('#gradient')} body {display:none}]]></style>
    <defs>
      <linearGradient id="gradient" x1="0" x2="100%" gradientUnits="userSpaceOnUse">
        <stop offset="0" style="stop-color:#f00;stop-opacity:.5"/>
        <stop offset="1" stop-color="#00f"/>
      </linearGradient>
      <clipPath id="clip"><circle cx="50" cy="40" r="20"/></clipPath>
      <path id="shape" d="M0 0h20v20z"/>
    </defs>
    <g clip-path="url(#clip)">
      <rect class="one" width="100" height="80" fill="red" style="fill:#456789"/>
      <path class="two" d="M10 10h20v20z"/>
      <use xlink:href="#shape" x="20"/>
    </g>
  </svg>`);
  assert.ok(styled);
  assert.equal(styled.attrs.viewBox, "0 0 100 80");
  assert.equal(styled.attrs.fill, "#fff");
  const styledNodes = flatten(styled);
  assert.equal(styledNodes.find((node) => node.tag === "stop").attrs["stop-color"], "#f00");
  assert.equal(styledNodes.find((node) => node.tag === "rect").attrs.fill, "#456789");
  assert.equal(styledNodes.find((node) => node.tag === "rect").attrs.stroke, "#fff");
  assert.equal(styledNodes.find((node) => node.tag === "g").attrs["clip-path"], "url(#logo-ref-2)");
  assert.equal(styledNodes.find((node) => node.tag === "use").attrs.href, "#logo-ref-3");
  assert.equal(styledNodes.find((node) => node.attrs.fill?.startsWith("url(")).attrs.fill, "url(#logo-ref-1)");
  assert.ok(!JSON.stringify(styled).match(/onload|position|class|xlink|CDATA|"style"/));

  const hostile = parseSvgLogo(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:foreign="https://evil.example/ns"
      viewBox="0 0 10 10" onload="alert(1)">
    <script>alert(1)</script>
    <foreignObject><style>.safe{fill:red}</style><image href="https://evil.example/pixel"/></foreignObject>
    <foreign:path d="M0 0h5v5z"/>
    <a href="https://evil.example"><path d="M0 0h5v5z"/></a>
    <image href="data:image/svg+xml,script"/>
    <animate attributeName="href" to="https://evil.example"/>
    <style>@import url(https://evil.example); .safe:hover {fill:red}</style>
    <path class="safe" d="M0 0h10v10z" onclick="alert(1)" fill="url(https://evil.example/pixel)"
      style="stroke:url(&quot;data:image/png,unsafe&quot;);filter:url(https://evil.example);fill:expression(alert(1))"/>
    <use href="https://evil.example/icon.svg#x"/>
    <use href="#missing"/>
  </svg>`);
  assert.ok(hostile);
  assert.equal(hostile.children.length, 3);
  assert.deepEqual(hostile.children[0].attrs, { d: "M0 0h10v10z" });
  assert.deepEqual(hostile.children[1].attrs, {});
  assert.deepEqual(hostile.children[2].attrs, {});
  assert.ok(!JSON.stringify(hostile).match(/evil|alert|expression|onload|onclick|script|image|foreign|style|class/));

  const escaped = parseSvgLogo(`<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"
    fill="u&#114;l(https://evil.example)" stroke="url(\\23 missing)"/></svg>`);
  assert.deepEqual(escaped.children[0].attrs, { d: "M0 0h10v10z" });

  const unsafeInputs = [
    null, undefined, 17, "", "<svg>", "<html><svg><path/></svg></html>",
    "<svg><path/></svg><svg><path/></svg>",
    '<!DOCTYPE svg><svg><path/></svg>',
    '<!DOCTYPE svg [<!ENTITY x "expanded">]><svg><path/>&x;</svg>',
    '<!DOCTYPE svg SYSTEM "https://evil.example/file"><svg><path/></svg>',
    '<svg><path/>&unknown;</svg>',
    '<svg><path id="same"/><path id="same"/></svg>',
    '<svg><g id="cycle"><use href="#cycle"/></g></svg>',
    '<svg><defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs><path fill="url(#a)"/></svg>',
    `<svg>${"<g>".repeat(64)}<path/>${"</g>".repeat(64)}</svg>`,
    `<svg>${"<path/>".repeat(4096)}</svg>`,
    `<svg><path/>${" ".repeat(512 * 1024)}</svg>`,
  ];
  for (const input of unsafeInputs) assert.equal(parseSvgLogo(input), null, `${browser}: reject unsafe or invalid SVG`);

  const expansion = '<svg><defs><path id="n0"/>' + Array.from({ length: 15 }, (_, i) =>
    `<g id="n${i + 1}"><use href="#n${i}"/><use href="#n${i}"/></g>`).join("")
    + '</defs><use href="#n15"/></svg>';
  assert.equal(parseSvgLogo(expansion), null, `${browser}: reject exponential local references`);
}

console.log("Verified SVG brand geometry, inherited fills, styles, local references, and hostile-input bounds in Chrome and Firefox.");
