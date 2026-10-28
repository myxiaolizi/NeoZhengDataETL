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
  console.log('════ v3.1 新功能验收 ════');
  await call('POST','/login',{username:'admin',password:'6655',redirect:'/'});

  section('修复1：项目卡片整卡可点击');
  const projPage = await call('GET','/projects');
  ok(projPage.data.includes('data-open='), '项目卡片带 data-open 属性');
  ok(projPage.data.includes('card.dataset.open'), '整卡点击跳转逻辑存在');

  section('修复2：报表可编辑');
  const repPage = await call('GET','/reports');
  ok(repPage.data.includes('data-edit='), '报表卡片有编辑按钮');
  ok(repPage.data.includes('function openEdit'), 'openEdit 函数存在');
  ok(repPage.data.includes('id="c_id"'), '编辑弹窗含隐藏 ID 字段');

  section('修复3：分享密码明文显示');
  ok(repPage.status === 200, '报表页正常');
  const sharePage = await call('GET','/shares');
  ok(sharePage.data.includes('访问密码'), '分享页表头为「访问密码」');
  ok(sharePage.data.includes('s.password'), '渲染明文密码');

  section('修复4：系统设置数据维护/登录日志卡片化');
  const setPage = await call('GET','/settings');
  ok(setPage.data.includes('TOOL_CARDS'), '工具卡片定义存在');
  ok(setPage.data.includes('tools_tables'), '数据维护卡片');
  ok(setPage.data.includes('tools_logs'), '登录日志卡片');
  ok(setPage.data.includes('renderTablesPanel'), '数据维护面板渲染函数');
  ok(setPage.data.includes('renderLogsPanel'), '登录日志面板渲染函数');
  const setBody = setPage.data.split('<script>')[0];
  ok(!setBody.includes('id="tableBody"') && !setBody.includes('id="loginLogBody"'), '数据维护/登录日志不再直接显示在下方（已卡片化）');

  section('新功能1：数据源支持更多类型');
  const dsApi = await call('GET','/api/datasources');
  ok(dsApi.data.ok, '数据源接口正常');
  const catalog = dsApi.data.data.catalog || [];
  const allTypes = catalog.reduce((a,c)=>a.concat(c.types.map(t=>t.key)),[]);
  ok(allTypes.length >= 13, '支持 ≥ 13 种数据库（实际 ' + allTypes.length + '）');
  ['mysql','mssql','postgres','oracle','sqlite','mongodb','redis','clickhouse','dm','kingbase'].forEach(t=>{
    ok(allTypes.includes(t), '包含类型：' + t);
  });

  section('新功能2：AI 供应商预设');
  const aiApi = await call('GET','/api/ai/providers');
  ok(aiApi.data.ok, 'AI 供应商接口正常');
  const provs = aiApi.data.data;
  ok(provs.length >= 8, '预设 ≥ 8 个供应商（实际 ' + provs.length + '）');
  ['deepseek','qwen','kimi','glm','mimo','openai'].forEach(k=>{
    const p = provs.find(x=>x.key===k);
    ok(!!p, '包含供应商：' + k + (p ? '（' + p.name + '）' : ''));
    if (p) ok(p.models.length > 0 && !!p.baseUrl, '  ' + k + ' 有模型与接口地址');
  });

  section('新功能3：组织架构');
  const deptApi = await call('GET','/api/departments');
  ok(deptApi.data.ok, '部门接口正常');
  const initR = await call('POST','/api/departments/init');
  ok(initR.data.ok, '初始化默认组织架构：' + (initR.data.message||''));
  const dept2 = await call('GET','/api/departments');
  ok(dept2.data.data.list.length >= 4, '部门树有 ' + dept2.data.data.list.length + ' 个部门');
  ok(dept2.data.data.tree.length >= 1, '部门树结构正常');

  section('新功能4：表单引擎');
  const ftApi = await call('GET','/api/form-field-types');
  const ftList = ftApi.data.data.types || ftApi.data.data;
  ok(ftApi.data.ok && ftList.length >= 20, '表单控件 ≥ 20 种（实际 ' + ftList.length + '）');

  const projList = await call('GET','/api/projects');
  const pid = projList.data.data[0] ? projList.data.data[0].id : null;

  const formCreate = await call('POST','/api/forms', {
    name:'测试表单', description:'v3.1 测试', projectId: pid, allowPublic: true,
    fields: [
      { key:'name', type:'text', label:'姓名', required:true },
      { key:'phone', type:'text', label:'手机号' },
      { key:'amount', type:'number', label:'金额', min:0 },
      { key:'level', type:'select', label:'等级', options:['A','B','C'] },
    ],
  });
  ok(formCreate.data.ok, '创建表单：' + (formCreate.data.message||''));
  const fid = formCreate.data.data && formCreate.data.data.id;
  const ftoken = formCreate.data.data && formCreate.data.data.publicToken;
  ok(!!ftoken, '表单有公开令牌');

  const formDesign = await call('GET','/forms/'+fid+'/design');
  ok(formDesign.status === 200 && formDesign.data.includes('fd-palette'), '表单设计器可访问');
  ok(formDesign.data.includes('draggable="true"'), '控件可拖拽');

  // 公开填写页
  const savedCookie = cookie; cookie='';
  const pubPage = await call('GET','/f/'+ftoken);
  ok(pubPage.status === 200 && pubPage.data.includes('mainForm'), '公开填写页可访问（无需登录）');

  // 提交数据
  const submit = await fetch(BASE+'/f/'+ftoken+'/submit', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name:'张三', phone:'13800138000', amount:1234.5, level:'A' }),
  });
  const subData = await submit.json();
  ok(subData.ok, '★ 表单提交成功：' + (subData.message||''));

  // 必填校验
  const badSubmit = await fetch(BASE+'/f/'+ftoken+'/submit', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ phone:'139' }),
  });
  const badData = await badSubmit.json();
  ok(!badData.ok && badSubmit.status === 400, '★ 必填校验生效：' + (badData.message||''));
  cookie = savedCookie;

  const recs = await call('GET','/api/forms/'+fid+'/records');
  ok(recs.data.ok && recs.data.data.total >= 2, '提交记录已保存（' + recs.data.data.total + ' 条）');

  const formData = await call('GET','/forms/'+fid+'/data');
  ok(formData.status === 200 && formData.data.includes('dataHead'), '表单数据页可访问');

  section('新功能5：数据处理流程');
  const ntApi = await call('GET','/api/flow-node-types');
  ok(ntApi.data.ok && ntApi.data.data.nodes.length >= 20, '流程节点 ≥ 20 种（实际 ' + ntApi.data.data.nodes.length + '）');

  const flowCreate = await call('POST','/api/flows', {
    name:'测试流程', description:'v3.1 测试',
    nodes: [
      { id:'n1', type:'source_manual', label:'手动数据', x:40, y:40,
        config:{ json: JSON.stringify([
          { name:'张三', amount:100, dept:'A' },
          { name:'李四', amount:200, dept:'B' },
          { name:'王五', amount:300, dept:'A' },
          { name:'赵六', amount:0, dept:'B' },
        ]) } },
      { id:'n2', type:'filter', label:'金额大于0', x:290, y:40,
        config:{ field:'amount', operator:'gt', value:'0' } },
      { id:'n3', type:'compute', label:'含税价', x:540, y:40,
        config:{ target:'tax_amount', expression:'ROUND({amount} * 1.13, 2)' } },
      { id:'n4', type:'aggregate', label:'按部门汇总', x:790, y:40,
        config:{ groupBy:'dept', aggregates:'人数=count:\n总额=sum:tax_amount' } },
    ],
    edges: [ {from:'n1',to:'n2'}, {from:'n2',to:'n3'}, {from:'n3',to:'n4'} ],
  });
  ok(flowCreate.data.ok, '创建流程：' + (flowCreate.data.message||''));
  const flowId = flowCreate.data.data && flowCreate.data.data.id;

  const flowDesign = await call('GET','/flows/'+flowId+'/design');
  ok(flowDesign.status === 200 && flowDesign.data.includes('flow-canvas'), '流程编排器可访问');
  ok(flowDesign.data.includes('startDrag'), '节点可拖拽');
  ok(flowDesign.data.includes('handleConnect'), '节点可连线');

  const preview = await call('POST','/api/flows/'+flowId+'/preview', {});
  ok(preview.data.ok, '★ 试运行成功');
  if (preview.data.ok) {
    const rows = preview.data.data.rows;
    console.log('        结果: ' + JSON.stringify(rows));
    ok(rows.length === 2, '★ 分组聚合得到 2 个部门');
    const a = rows.find(r=>r.dept==='A');
    ok(!!a && a.人数 === 2, '★ 部门A有2人');
    ok(!!a && Math.abs(a.总额 - 452) < 0.01, '★ 部门A总额 = 100*1.13 + 300*1.13 = 452（实际 ' + (a?a.总额:'?') + '）');
  }

  const flowLogs = await call('GET','/api/flows/'+flowId+'/logs');
  ok(flowLogs.data.ok, '流程日志接口正常');

  section('新功能6：个人中心头像');
  const profPage = await call('GET','/profile');
  ok(profPage.data.includes('avatarModal'), '头像弹窗存在');
  ok(profPage.data.includes('onAvatarFile'), '头像上传函数存在');
  ok(profPage.data.includes('avatar-colors'), '头像色板存在');

  const avatarSave = await call('PUT','/api/me/profile', { avatarColor:'#2D6FE4' });
  ok(avatarSave.data.ok, '★ 保存头像底色成功');
  const meAfter = await call('GET','/api/me');
  ok(meAfter.data.data.avatarColor === '#2D6FE4', '★ 头像底色已生效');

  section('新功能7：用户管理 5 个标签卡片');
  const userPage = await call('GET','/users');
  ok(userPage.data.includes('tab-cards'), '标签卡片容器存在');
  ['用户管理','角色权限','组织架构','角色权限说明','权限点说明'].forEach(t=>{
    ok(userPage.data.includes(t), '包含标签：' + t);
  });
  ok(!userPage.data.includes('href="/roles"'), '菜单中已移除角色权限入口');

  section('新功能8：菜单调整');
  const layoutPage = await call('GET','/');
  ok(layoutPage.data.includes('表单中心'), '菜单含「表单中心」');
  ok(layoutPage.data.includes('处理流程'), '菜单含「处理流程」');
  ok(!layoutPage.data.includes('>角色权限<'), '菜单不含「角色权限」');

  section('新功能9：使用说明覆盖全部功能');
  const helpPage = await call('GET','/help');
  ok(helpPage.status === 200, '使用说明页可访问');
  ['平台总览','数据接入','表单中心','数据处理','数据源','报表与 BI','AI 问数','数据治理','系统管理','常见问题'].forEach(t=>{
    ok(helpPage.data.includes(t), '使用说明含章节：' + t);
  });

  section('新功能10：数据集成双模式');
  const intPage = await call('GET','/integrations');
  ok(intPage.data.includes('collect-modes'), '采集方式卡片存在');
  ok(intPage.data.includes('接收第三方推送'), '含「接收第三方推送」卡片');
  ok(intPage.data.includes('接口采集数据'), '含「接口采集数据」卡片');
  ok(intPage.data.includes('showPushUrl'), '含接收地址生成函数');
  ok(intPage.data.includes('pushUrlModal'), '含接收地址弹窗');

  section('清理测试数据');
  await call('DELETE','/api/forms/'+fid);
  await call('DELETE','/api/flows/'+flowId);
  await call('PUT','/api/me/profile', { avatarColor:'' });
  ok(true, '清理完成');

  console.log('\n════ 结果 ════');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail?1:0);
})().catch(e=>{ console.error('异常:', e); process.exit(1); });
