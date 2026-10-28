const BASE = process.env.BASE || 'http://127.0.0.1:8781';
let cookie='';
function capture(r){
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  sc.forEach(c=>{ if(c && c.startsWith('jdy_sid=')) cookie = c.split(';')[0]; });
}
async function call(m,p,b){
  const h={}; if(cookie)h.Cookie=cookie;
  if(b!==undefined)h['Content-Type']='application/json; charset=utf-8';
  const r=await fetch(BASE+p,{method:m,headers:h,body:(m==='GET')?undefined:(b===undefined?undefined:JSON.stringify(b)),redirect:'manual'});
  capture(r);
  const ct=r.headers.get('content-type')||'';
  return {status:r.status, data: ct.includes('json')?await r.json():await r.text()};
}
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log('  OK   '+m);} else {fail++;console.log('  FAIL '+m);} };
const section=t=>console.log('\n── '+t+' ──');

(async()=>{
  console.log('════ v3.3 验收 ════');

  section('项目重命名');
  await call('POST','/login',{username:'admin',password:'6655',redirect:'/'});
  const st = await call('GET','/api/settings');
  ok(st.data.data.values.site_name === 'Neo Zheng DataETL', '站点名称为 Neo Zheng DataETL（实际 ' + st.data.data.values.site_name + '）');
  ok(st.data.data.values.site_logo_text === 'N', 'Logo 文字为 N');

  section('项目介绍页');
  const intro = await call('GET','/intro');
  ok(intro.status === 200, '介绍页可访问');
  ok(intro.data.includes('Neo Zheng DataETL'), '含项目名称');
  ok(intro.data.includes('CASES'), '含行业案例数据');
  ok(intro.data.includes('连锁药店'), '含连锁药店案例');
  const introBody = intro.data.split('<script>')[0];
  ok(!introBody.includes('简道云'), '不提及简道云');
  // 统计案例数
  const caseCount = (intro.data.match(/industry:/g) || []).length;
  ok(caseCount >= 11, '行业案例 ≥ 11 个（实际 ' + caseCount + '）');

  section('数据源类型目录');
  const dt = await call('GET','/api/datasource-types');
  ok(dt.data.ok, '类型目录接口正常');
  const d = dt.data.data;
  ok(d.categories.length === 15, '15 个分类（实际 ' + d.categories.length + '）');
  ok(d.stats.types >= 80, '类型数 ≥ 80（实际 ' + d.stats.types + '）');
  console.log('        分类: ' + d.categories.map(c=>c.name).join(' / '));

  // 验证关键类型存在
  const allTypes = d.catalog.reduce((a,c)=>a.concat(c.types.map(t=>t.key)),[]);
  ['dingtalk','wecom','feishu','haidian','yunuo','qianfang','yonyou','wps',
   'wechat_mp','wechat_mini','wechat_pay','alipay','taobao','eleme',
   'mysql','mssql','postgres','oracle','clickhouse','dm','kingbase',
   'mongodb','redis','elasticsearch','neo4j','milvus','influxdb','kafka','nacos'].forEach(k=>{
    ok(allTypes.includes(k), '含类型：' + k);
  });

  section('办公软件接口详情');
  const fs1 = await call('GET','/api/datasource-types/feishu');
  ok(fs1.data.ok, '飞书类型详情');
  ok(fs1.data.data.resources.length >= 5, '飞书资源 ≥ 5 个（' + fs1.data.data.resources.map(r=>r.name).join(', ') + '）');
  const dt1 = await call('GET','/api/datasource-types/dingtalk');
  ok(dt1.data.data.resources.length >= 5, '钉钉资源 ≥ 5 个');
  const wc1 = await call('GET','/api/datasource-types/wecom');
  ok(wc1.data.data.resources.length >= 5, '企微资源 ≥ 5 个');

  section('数据源页面');
  const dsPage = await call('GET','/datasources');
  ok(dsPage.status === 200, '数据源页可访问');
  ok(dsPage.data.includes('typePickerModal'), '含类型选择弹窗');
  ok(dsPage.data.includes('tpCats'), '含分类列表');
  ok(dsPage.data.includes('tpTypes'), '含类型网格');
  ok(dsPage.data.includes('openTypePicker'), '含打开选择器函数');

  section('表单���度设计预览');
  const forms = await call('GET','/api/forms');
  let fid = null;
  if (forms.data.data.list.length) {
    fid = forms.data.data.list[0].id;
  } else {
    const nf = await call('POST','/api/forms', { name:'宽度测试', formType:'fill', fields:[] });
    fid = nf.data.data.id;
  }
  const design = await call('GET','/forms/'+fid+'/design');
  ok(design.status === 200, '表单设计器可访问');
  ok(design.data.includes('fd-grid'), '12 栅格布局');
  ok(design.data.includes('canvasWidth'), '画布宽度可调');
  ok(design.data.includes('spanOf'), '宽度自适应计算');
  ok(design.data.includes('data-quick="1/5"'), '支持 1/5 宽度');
  ok(design.data.includes('data-quick="1/4"'), '支持 1/4 宽度');
  ok(design.data.includes('data-quick="1/3"'), '支持 1/3 宽度');
  ok(design.data.includes('data-quick="1/2"'), '支持 1/2 宽度');
  ok(design.data.includes('widthPreview'), '含宽度分布预览');

  section('表单三种类型');
  const ft = await call('GET','/api/form-field-types');
  ok(ft.data.data.formTypes.length === 3, '3 种表单类型');
  ok(ft.data.data.formTypes.map(t=>t.key).join(',') === 'fill,flow,exam', '类型为 fill/flow/exam');

  console.log('\n════ 结果 ════');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail?1:0);
})().catch(e=>{ console.error('异常:', e.message); process.exit(1); });
