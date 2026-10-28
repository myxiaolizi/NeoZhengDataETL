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
  console.log('════ v3.2 验收 ════');

  section('登录页');
  const lg = await call('GET','/login');
  ok(lg.status === 200, '登录页可访问');
  ok(lg.data.includes('lg-shell'), '新登录页布局');
  ok(lg.data.includes('数据集成'), '含平台定位文案');
  ok(!lg.data.includes('6655'), '不显示默认密码');

  await call('POST','/login',{username:'admin',password:'6655',redirect:'/'});

  section('项目详情 7 标签页');
  const pd = await call('GET','/projects/16');
  ['项目首页','原始数据','解析后数据','接收日志','字段结构','子表数据','字段设置'].forEach(t=>{
    ok(pd.data.includes('>'+t+'<'), '标签：' + t);
  });
  ok(pd.data.includes('pushUrlText'), '项目首页含推送地址');
  ok(pd.data.includes('toggleHomeEdit'), '项目首页可切换编辑');
  ok(pd.data.includes('loadFieldSettings'), '字段设置页签有加载函数');

  section('菜单结构');
  const home = await call('GET','/');
  const navMatch = home.data.match(/<nav class="nav">([\s\S]*?)<\/nav>/);
  const nav = navMatch ? navMatch[1] : '';
  const dmIdx = nav.indexOf('数据管理');
  ok(dmIdx > 0, '存在「数据管理」分组');
  ok(nav.indexOf('数据源') > dmIdx, '数据源在数据管理下');
  ok(nav.indexOf('href="/datasets"') > dmIdx, '数据集在数据管理下');
  ok(!nav.includes('角色权限'), '菜单无角色权限');

  section('CRM 看板');
  const crm = await call('GET','/dashboard/crm');
  ok(crm.status === 200, 'CRM 看板可访问');
  ['cardTotal','cardStores','cardProgress','cardIng','cardDone','cardRegion','cardTask','cardFlow','cardType','cardRank','cardTrend','cardDetail'].forEach(id=>{
    ok(crm.data.includes('id="'+id+'"'), '区块：' + id);
  });
  const crmApi = await call('GET','/api/crm/dashboard?projectId=16');
  ok(crmApi.data.ok, 'CRM 数据接口正常');
  if (crmApi.data.ok) {
    ok(crmApi.data.data.kpi.total === 47, '签约客户 47 家');
    ok(crmApi.data.data.kpi.totalStores === 7272, '门店总数 7272');
  }

  section('表单类型与宽度');
  const ftApi = await call('GET','/api/form-field-types');
  ok(ftApi.data.ok, '表单元数据接口正常');
  const meta = ftApi.data.data;
  ok(meta.formTypes.length === 3, '3 种表单类型：' + meta.formTypes.map(t=>t.name).join(', '));
  ok(meta.widths.length === 5, '5 种宽度：' + meta.widths.map(w=>w.key).join(', '));
  ok(meta.optionLayouts.length === 3, '3 种选项布局：' + meta.optionLayouts.map(o=>o.name).join(', '));

  // 创建考试表单
  const examForm = await call('POST','/api/forms', {
    name:'测试考试', formType:'exam', allowPublic:true,
    settings:{ examPassScore:60, examDuration:30, examShowAnswer:true, shareTitle:'知识测验', shareIcon:'📝', shareDesc:'请认真作答' },
    fields:[
      { key:'q1', type:'radio', label:'题目1', score:10, answer:'A', options:['A','B','C'], optionLayout:'vertical' },
      { key:'q2', type:'checkbox', label:'题目2', score:20, answer:'A,B', options:['A','B','C'], minSelect:1, maxSelect:2 },
      { key:'q3', type:'text', label:'题目3', score:10, answer:'hello', width:'1/2' },
    ],
  });
  ok(examForm.data.ok, '创建考试表单');
  const efid = examForm.data.data && examForm.data.data.id;
  const etoken = examForm.data.data && examForm.data.data.publicToken;
  ok(examForm.data.data.formType === 'exam', '表单类型为 exam');
  ok(examForm.data.data.shareTitle === '知识测验', '分享标题已保存');
  ok(examForm.data.data.shareIcon === '📝', '分享图标已保存');

  section('考试判分');
  const savedCookie = cookie; cookie='';
  const sub = await fetch(BASE+'/f/'+etoken+'/submit', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ q1:'A', q2:['A','B'], q3:'hello' }),
  });
  const subData = await sub.json();
  ok(subData.ok, '考试提交成功');
  if (subData.ok && subData.data.examResult) {
    const r = subData.data.examResult;
    ok(r.earned === 40, '满分 40（实际 ' + r.earned + '）');
    ok(r.percent === 100, '得分率 100%');
    ok(r.passed === true, '判定通过');
  } else {
    ok(false, '未返回判分结果');
  }
  cookie = savedCookie;

  section('表单宽度与选项布局');
  const designPage = await call('GET','/forms/'+efid+'/design');
  ok(designPage.status === 200, '表单设计器可访问');
  ok(designPage.data.includes('fd-grid'), '使用 12 栅格布局');
  ok(designPage.data.includes('spanOf'), '宽度自适应函数存在');
  ok(designPage.data.includes('optionLayout'), '选项布局配置存在');
  ok(designPage.data.includes('minSelect'), '多选最少配置存在');
  ok(designPage.data.includes('p_default'), '默认值配置存在');
  ok(designPage.data.includes('p_linkSource'), '联动数据配置存在');
  ok(designPage.data.includes('p_formula'), '公式配置存在');
  ok(designPage.data.includes('sh_title'), '分享标题配置存在');
  ok(designPage.data.includes('sh_icon'), '分享图标配置存在');

  section('清理');
  await call('DELETE','/api/forms/'+efid);
  ok(true, '清理测试表单');

  console.log('\n════ 结果 ════');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail?1:0);
})().catch(e=>{ console.error('异常:', e.message); process.exit(1); });
