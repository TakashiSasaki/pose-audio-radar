import fs from 'node:fs';
import path from 'node:path';

console.log('=== 🔍 Starting HTML, SEO, Robots.txt & Sitemap Validation ===\n');

let errors = [];
let warnings = [];
let passed = [];

// 1. Validate index.html
const htmlPath = path.resolve('index.html');
if (!fs.existsSync(htmlPath)) {
  errors.push('index.html does not exist');
} else {
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Check doctype & lang
  if (/^<!doctype html>/i.test(html.trim())) {
    passed.push('HTML5 DOCTYPE present at start');
  } else {
    errors.push('Missing or invalid <!doctype html>');
  }

  if (/<html\s+lang="ja">/i.test(html)) {
    passed.push('html element with lang="ja" attribute present');
  } else {
    warnings.push('html tag missing lang="ja"');
  }

  // Check <head> and <body> structure
  if (html.includes('<head>') && html.includes('</head>') && html.includes('<body>') && html.includes('</body>')) {
    passed.push('Proper <head> and <body> tag structure');
  } else {
    errors.push('Malformed <head> or <body> tags');
  }

  // Meta checks
  if (/<meta\s+charset="UTF-8"\s*\/>/i.test(html)) {
    passed.push('UTF-8 Charset specified');
  } else {
    errors.push('Missing UTF-8 charset meta');
  }

  if (/<meta\s+name="viewport"/i.test(html)) {
    passed.push('Viewport meta tag present');
  } else {
    errors.push('Missing viewport meta tag');
  }

  if (/<title>.*<\/title>/i.test(html)) {
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    passed.push(`Title tag present: "${titleMatch ? titleMatch[1] : ''}"`);
  } else {
    errors.push('Missing <title> tag');
  }

  if (/<meta\s+name="description"/i.test(html)) {
    passed.push('Meta description tag present');
  } else {
    errors.push('Missing meta description tag');
  }

  // Canonical & Sitemap link
  if (/<link\s+rel="canonical"\s+href="https:\/\/pose-audio-radar\.moukaeritai\.work\/"\s*\/>/i.test(html)) {
    passed.push('Canonical link tag correctly pointing to https://pose-audio-radar.moukaeritai.work/');
  } else {
    warnings.push('Canonical link missing or not pointing to target domain');
  }

  if (/<link\s+rel="sitemap"/i.test(html)) {
    passed.push('Sitemap link tag (<link rel="sitemap">) present in HTML');
  } else {
    warnings.push('Missing <link rel="sitemap"> tag in HTML');
  }

  // Robots meta
  if (/<meta\s+name="robots"\s+content="index,\s*follow/i.test(html)) {
    passed.push('Robots meta tag explicitly allowing index, follow');
  } else {
    warnings.push('Robots meta tag missing or restrictive');
  }

  // JSON-LD Validation
  const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi);
  if (jsonLdMatches) {
    for (const match of jsonLdMatches) {
      const jsonContent = match.replace(/<script type="application\/ld\+json">/i, '').replace(/<\/script>/i, '');
      try {
        JSON.parse(jsonContent);
        passed.push('Schema.org JSON-LD structured data is valid JSON');
      } catch (err) {
        errors.push(`Invalid JSON-LD syntax: ${err.message}`);
      }
    }
  } else {
    warnings.push('No JSON-LD script found in index.html');
  }
}

// 2. Validate robots.txt
const robotsPath = path.resolve('public/robots.txt');
if (!fs.existsSync(robotsPath)) {
  errors.push('public/robots.txt does not exist');
} else {
  const robots = fs.readFileSync(robotsPath, 'utf8');
  if (/User-agent:\s*\*/i.test(robots) && /Allow:\s*\//i.test(robots)) {
    passed.push('robots.txt allows all crawlers (User-agent: * / Allow: /)');
  } else {
    errors.push('robots.txt does not allow all crawlers');
  }

  if (/Sitemap:\s*https:\/\/pose-audio-radar\.moukaeritai\.work\/sitemap\.xml/i.test(robots)) {
    passed.push('robots.txt contains correct Sitemap directive pointing to https://pose-audio-radar.moukaeritai.work/sitemap.xml');
  } else {
    errors.push('robots.txt missing or incorrect Sitemap directive');
  }
}

// 3. Validate sitemap.xml
const sitemapPath = path.resolve('public/sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
  errors.push('public/sitemap.xml does not exist');
} else {
  const sitemap = fs.readFileSync(sitemapPath, 'utf8');

  if (sitemap.includes('xmlns:xhtml') || sitemap.includes('<xhtml:link')) {
    errors.push('sitemap.xml contains prohibited xhtml elements/namespaces');
  } else {
    passed.push('sitemap.xml is free of xhtml extension tags');
  }

  if (sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9')) {
    passed.push('sitemap.xml uses standard Sitemaps 0.9 namespace');
  } else {
    errors.push('sitemap.xml missing standard 0.9 namespace');
  }

  // Sequence check: loc -> lastmod -> changefreq -> priority
  const locIdx = sitemap.indexOf('<loc>');
  const lastmodIdx = sitemap.indexOf('<lastmod>');
  const changefreqIdx = sitemap.indexOf('<changefreq>');
  const priorityIdx = sitemap.indexOf('<priority>');

  if (locIdx < lastmodIdx && lastmodIdx < changefreqIdx && changefreqIdx < priorityIdx) {
    passed.push('sitemap.xml elements follow strict XML schema sequence (<loc> -> <lastmod> -> <changefreq> -> <priority>)');
  } else {
    errors.push('sitemap.xml element order violates XML schema sequence');
  }
}

console.log(`✅ PASSED CHECKS (${passed.length}):`);
passed.forEach(p => console.log(`   - ${p}`));

if (warnings.length > 0) {
  console.log(`\n⚠️ WARNINGS (${warnings.length}):`);
  warnings.forEach(w => console.log(`   - ${w}`));
}

if (errors.length > 0) {
  console.log(`\n❌ ERRORS (${errors.length}):`);
  errors.forEach(e => console.log(`   - ${e}`));
  process.exit(1);
} else {
  console.log('\n🎉 ALL VALIDATIONS PASSED SUCCESSFULY!');
}
