import re,os
A='app'
idx=open(f'{A}/index.html').read()
head='<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
os.makedirs('dist',exist_ok=True)
open(f'{A}/_test.html','w').write(head+idx+'</body></html>')
# standalone single file
s=idx.replace('<link rel="stylesheet" href="styles.css">','<style>\n'+open(f'{A}/styles.css').read()+'\n</style>')
for js in ['fonts.js','core.js','app.js']:
    s=s.replace(f'<script src="{js}"></script>','<script>\n'+open(f'{A}/{js}').read().replace('</script','<\\/script')+'\n</script>')
open('dist/Драфт.html','w').write(head+s+'</body></html>')
print('ok', os.path.getsize('dist/Драфт.html'))
