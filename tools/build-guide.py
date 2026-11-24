#!/usr/bin/env python3
"""Baut das Feldhandbuch (Obsidian-Vault) in die Web-App ein.

Aufruf:  python3 tools/build-guide.py "<Pfad zum Vault-Ordner 'Hotz Feldhandbuch'>"

- kopiert die Notizen 00–08 nach guide/src/ (Quelle zum Nachbauen)
- schreibt guide/data.js (Seiten als HTML + Suchindex)
- wandelt Abbildungen/Fotos nach guide/img/*.webp (klein, offline-tauglich)

Benötigt: pip install markdown pillow
"""
import html
import json
import re
import shutil
import sys
import unicodedata
from pathlib import Path

import markdown
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'guide'

# Notizname (ohne Nummer) -> kurze Seiten-ID für die Adresse #/handbuch/<id>
PAGES = [
    ('00', 'start', 'Übersicht'),
    ('01', 'grundlagen', 'Grundlagen'),
    ('02', 'tortypen', 'Tortypen'),
    ('03', 'tore', 'Formular 1 – Tore'),
    ('04', 'tueren', 'Formular 2 – Türen'),
    ('05', 'beispiele', 'Beispiele'),
    ('06', 'maengel', 'Mängel-Formulierungen'),
    ('07', 'glossar', 'Glossar'),
    ('08', 'links', 'Handbücher und Links'),
]


def slug(s):
    s = unicodedata.normalize('NFKD', s.lower())
    s = s.replace('ß', 'ss')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')[:60] or 'x'


def img_name(src):
    return Path(src).stem + '.webp'


def convert_images(vault):
    dst = OUT / 'img'
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    sizes = {}
    for folder in ('Abbildungen', 'Fotos'):
        for f in sorted((vault / folder).glob('*')):
            if f.suffix.lower() not in ('.png', '.jpg', '.jpeg'):
                continue
            im = Image.open(f)
            im.load()
            if im.mode in ('P', 'LA', 'RGBA'):
                bg = Image.new('RGB', im.size, 'white')
                rgba = im.convert('RGBA')
                bg.paste(rgba, mask=rgba.split()[-1])
                im = bg
            else:
                im = im.convert('RGB')
            im.thumbnail((1800, 1800))
            out = dst / img_name(f.name)
            im.save(out, 'WEBP', quality=80 if folder == 'Fotos' else 88, method=6)
            sizes[f.name] = im.size
    return sizes


def main(vault):
    vault = Path(vault)
    notes = {}
    for num, pid, short in PAGES:
        f = next(vault.glob(f'{num} *.md'))
        notes[f.stem] = (pid, short, f)

    src = OUT / 'src'
    if src.exists():
        shutil.rmtree(src)
    src.mkdir(parents=True)
    for _, (_, _, f) in notes.items():
        shutil.copy(f, src / f.name)

    sizes = convert_images(vault)

    def page_of(name):
        name = name.strip()
        if name in notes:
            return notes[name][0]
        for k, v in notes.items():  # tolerant: nur Nummer oder Titel
            if k.split(' ', 1)[-1] == name or k.startswith(name):
                return v[0]
        return None

    def wikilink(m):
        target, text = m.group(1), m.group(2)
        page, _, anchor = target.partition('#')
        pid = page_of(page) if page else None
        anchor = anchor.lstrip('^')
        anchor = anchor if re.match(r'^abb-\d+$', anchor) else (slug(anchor) if anchor else '')
        label = text or (anchor and target) or page
        if not pid:
            return html.escape(label)
        href = f'#/handbuch/{pid}' + (f'/{anchor}' if anchor else '')
        return f'<a href="{href}">{html.escape(label)}</a>'

    def embed(m):
        name, opt, block = m.group(1), m.group(2), m.group(3)
        w, h = sizes.get(name, (None, None))
        fid = f' id="{block}"' if block else ''
        dims = f' width="{w}" height="{h}"' if w else ''
        cls = 'gfig photo' if opt else 'gfig'
        return (f'<figure class="{cls}"{fid}><img src="guide/img/{img_name(name)}"{dims} '
                f'loading="lazy" alt="{html.escape(Path(name).stem)}" data-zoom></figure>')

    out_pages, index = [], []
    for stem, (pid, short, f) in notes.items():
        text = f.read_text(encoding='utf-8')
        text = re.sub(r'\A---\n.*?\n---\n', '', text, flags=re.S)
        title_m = re.search(r'^# (.+)$', text, flags=re.M)
        title = title_m.group(1).strip() if title_m else short

        # Callouts  > [!info] Titel  ->  <div class="callout info">
        def callout(m):
            kind, ctitle, body = m.group(1).lower(), m.group(2).strip(), m.group(3)
            body = re.sub(r'^> ?', '', body, flags=re.M)
            t = f'<p class="callout-t">{html.escape(ctitle)}</p>\n' if ctitle else ''
            return f'<div class="callout {kind}" markdown="1">\n{t}\n{body}\n</div>\n'
        text = re.sub(r'^> \[!(\w+)\][+-]?(.*)\n((?:>.*\n?)*)', callout, text, flags=re.M)

        text = re.sub(r'!\[\[([^\]|]+)(?:\|([^\]]*))?\]\](?:[ \t]*\^([\w-]+))?', embed, text)
        text = re.sub(r'\[\[([^\]|]+)(?:\|([^\]]*))?\]\]', wikilink, text)

        md = markdown.Markdown(extensions=['tables', 'md_in_html', 'sane_lists'])
        body = md.convert(text)

        # Überschriften mit IDs versehen (für Sprungziele und Suche)
        seen = {}
        cur = {'h2': '', 'h3': ''}

        def head(m):
            lvl, inner = m.group(1), m.group(2)
            plain = html.unescape(re.sub(r'<[^>]+>', '', inner)).strip()
            hid = slug(plain)
            seen[hid] = seen.get(hid, 0) + 1
            if seen[hid] > 1:
                hid += f'-{seen[hid]}'
            if lvl == '1':
                return f'<h1>{inner}</h1>'
            if lvl in ('2', '3'):
                cur['h' + lvl] = plain
                if lvl == '2':
                    cur['h3'] = ''
            index.append({'p': pid, 'a': hid, 't': plain, 'l': int(lvl),
                          's': cur['h3'] or cur['h2'] if lvl == '4' else ''})
            return f'<h{lvl} id="{hid}">{inner}</h{lvl}>'
        body = re.sub(r'<h([1-6])>(.*?)</h\1>', head, body)

        # Externe Links in neuem Tab
        body = re.sub(r'<a href="(https?://[^"]+)"', r'<a href="\1" target="_blank" rel="noopener"', body)
        body = body.replace('<table>', '<div class="gtable"><table>').replace('</table>', '</table></div>')
        # Unter-Überschrift (kursive englische Zeile direkt unter #### ) als Untertitel
        body = re.sub(r'(</h[2-4]>)\s*<p><em>([^<]*)</em></p>', r'\1\n<p class="gsub">\2</p>', body)

        # Suchtext je Abschnitt (#### ...) für die Volltextsuche
        out_pages.append({'id': pid, 'short': short, 'title': title, 'html': body})

    # Volltext je Überschrift: Text bis zur nächsten Überschrift
    for pg in out_pages:
        parts = re.split(r'(<h[2-4] id="[^"]+">)', pg['html'])
        for i in range(1, len(parts), 2):
            hid = re.search(r'id="([^"]+)"', parts[i]).group(1)
            txt = html.unescape(re.sub(r'<[^>]+>', ' ', parts[i + 1]))
            txt = re.sub(r'\s+', ' ', txt).strip()
            for e in index:
                if e['p'] == pg['id'] and e['a'] == hid:
                    e['x'] = txt[:4000]

    js = ('// Automatisch erzeugt von tools/build-guide.py – nicht von Hand ändern.\n'
          'export const PAGES = ' + json.dumps(out_pages, ensure_ascii=False) + ';\n'
          'export const INDEX = ' + json.dumps(index, ensure_ascii=False) + ';\n')
    (OUT / 'data.js').write_text(js, encoding='utf-8')
    print('pages', len(out_pages), 'headings', len(index), 'data.js', len(js.encode()) // 1024, 'KB')
    print('images', sum(p.stat().st_size for p in (OUT / 'img').glob('*')) // 1024, 'KB')


if __name__ == '__main__':
    main(sys.argv[1])
