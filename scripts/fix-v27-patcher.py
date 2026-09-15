from pathlib import Path
p=Path('scripts/apply-v27-transcript-patch.py')
s=p.read_text()
old="""replace_once(validator,\nr'''  const postErrors = Array.isArray(post.errors) ? post.errors.join(' | ') : '';\n  check('Post understanding complete' ''',\nr'''  check('Every-video meaning stage complete', meaning.status === 'complete', `${meaning.status || 'missing'} requested=${n(meaning.requested)} completed=${n(meaning.completed)} failed=${n(meaning.failed)}`);\n  check('Every collected video received semantic meaning', n(meaning.requested) > 0 && n(meaning.completed) === n(meaning.requested) && n(meaning.failed) === 0, `completed=${n(meaning.completed)}/${n(meaning.requested)}, failed=${n(meaning.failed)}`);\n  const postErrors = Array.isArray(post.errors) ? post.errors.join(' | ') : '';\n  check('Post understanding complete' ''')"""
new="""replace_once(validator,\nr'''  const postErrors = Array.isArray(post.errors) ? post.errors.join(' | ') : '';''',\nr'''  check('Every-video meaning stage complete', meaning.status === 'complete', `${meaning.status || 'missing'} requested=${n(meaning.requested)} completed=${n(meaning.completed)} failed=${n(meaning.failed)}`);\n  check('Every collected video received semantic meaning', n(meaning.requested) > 0 && n(meaning.completed) === n(meaning.requested) && n(meaning.failed) === 0, `completed=${n(meaning.completed)}/${n(meaning.requested)}, failed=${n(meaning.failed)}`);\n  const postErrors = Array.isArray(post.errors) ? post.errors.join(' | ') : '';''')"""
if old not in s:
    raise SystemExit('validator patcher repair anchor not found')
p.write_text(s.replace(old,new,1))
print('patcher repaired')
