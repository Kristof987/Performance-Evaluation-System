// @ts-nocheck
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import './People.css';
import './hr-home.css';

const html = `
  <div class="page layout">
    <aside class="sidebar">
      <div class="company"><div class="logo"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/></svg></div><div class="company-name">Compass</div></div>
      <nav class="sidebar-nav">
        <div class="nav-item" data-link="/hr-home"><svg style="width:17px;height:17px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg><span class="nav-item-label">Dashboard</span></div>
        <div class="nav-item active" data-link="/people"><svg style="width:17px;height:17px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/></svg><span class="nav-item-label">People</span></div>
        <div class="nav-item" data-link="/campaigns"><svg style="width:17px;height:17px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v2"/><path d="M21.34 15.664a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/><path d="M8 22H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg><span class="nav-item-label">Campaigns</span></div>
        <div class="nav-item" data-link="/forms"><svg style="width:17px;height:17px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8"/><path d="M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z"/><path d="M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"/></svg><span class="nav-item-label">Forms</span></div>
        <div class="nav-item"><svg style="width:17px;height:17px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16v5"/><path d="M16 14.639V21"/><path d="M20 10.656V21"/><path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15"/><path d="M4 18.463V21"/><path d="M8 14.656V21"/></svg><span class="nav-item-label">Reports</span></div>
        <div class="nav-item"><svg style="width:17px;height:17px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/></svg><span class="nav-item-label">Settings</span></div>
      </nav>
      <div class="sidebar-spacer"></div>
      <div class="user-menu"><div class="user-avatar"><div class="user-initials">SM</div></div><div class="user-info"><div class="user-name">Sarah Miller</div><div class="user-role">HR Admin</div></div><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8B91A8" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg></div>
    </aside>

    <main class="main">
      <div class="top-actions"><button class="icon-btn">⌕</button><button class="icon-btn">🔔</button></div>
      <section class="hello">
        <h1>People</h1>
        <p>Manage employees, roles, emails and group memberships.</p>
      </section>

      <section class="page-head">
        <div class="title">
          <h2>Employee directory</h2>
          <p>One employee can belong to multiple groups used in review campaigns.</p>
        </div>
        <div class="actions">
          <button class="btn primary" id="addEmployeeBtn">Add employee</button>
        </div>
      </section>

      <div class="tabs">
        <div class="tab active">Employees</div>
        <div class="tab">Groups</div>
      </div>

      <section class="metrics">
        <div class="metric"><span>Total employees</span><strong>128</strong><em>Across 9 groups</em></div>
        <div class="metric"><span>Active participants</span><strong>116</strong><em>Included in campaigns</em></div>
        <div class="metric"><span>Missing group</span><strong>7</strong><em>Needs attention</em></div>
        <div class="metric"><span>Invited</span><strong>5</strong><em>Waiting for activation</em></div>
      </section>

      <section class="workspace">
        <div>
          <div class="toolbar">
            <input placeholder="Search name, email or role…" />
            <select><option>All groups</option><option>Engineering</option><option>Managers</option><option>Sales</option></select>
            <select><option>All statuses</option><option>Active</option><option>Invited</option></select>
          </div>

          <div class="table-card">
            <table class="table">
              <thead><tr><th><button data-sort="name">Employee</button></th><th><button data-sort="role">Role</button></th><th><button data-sort="groups">Groups</button></th><th><button data-sort="status">Status</button></th><th></th></tr></thead>
              <tbody id="employeeRows">
                <tr data-name="Anna Molnár" data-role="Engineering Manager" data-groups="Engineering, Managers" data-status="Active">
                  <td><div class="person"><div class="mini">AM</div><div><strong>Anna Molnár</strong><span>anna.molnar@company.com</span></div></div></td>
                  <td>Engineering Manager</td>
                  <td><div class="badges"><span class="badge">Engineering</span><span class="badge">Managers</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Bence Lakatos" data-role="Frontend Developer" data-groups="Engineering, Remote" data-status="Active">
                  <td><div class="person"><div class="mini">BL</div><div><strong>Bence Lakatos</strong><span>bence.lakatos@company.com</span></div></div></td>
                  <td>Frontend Developer</td>
                  <td><div class="badges"><span class="badge">Engineering</span><span class="badge">Remote</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Eszter Papp" data-role="Product Designer" data-groups="Product, Design" data-status="Active">
                  <td><div class="person"><div class="mini">EP</div><div><strong>Eszter Papp</strong><span>eszter.papp@company.com</span></div></div></td>
                  <td>Product Designer</td>
                  <td><div class="badges"><span class="badge">Product</span><span class="badge">Design</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Krisztián Tóth" data-role="Sales Lead" data-groups="Sales, Managers" data-status="Invited">
                  <td><div class="person"><div class="mini">KT</div><div><strong>Krisztián Tóth</strong><span>krisztian.toth@company.com</span></div></div></td>
                  <td>Sales Lead</td>
                  <td><div class="badges"><span class="badge">Sales</span><span class="badge">Managers</span></div></td>
                  <td><span class="status invited">Invited</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Nóra Rácz" data-role="HR Specialist" data-groups="People Ops" data-status="Active">
                  <td><div class="person"><div class="mini">NR</div><div><strong>Nóra Rácz</strong><span>nora.racz@company.com</span></div></div></td>
                  <td>HR Specialist</td>
                  <td><div class="badges"><span class="badge">People Ops</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Dániel Farkas" data-role="Backend Developer" data-groups="Engineering" data-status="Active">
                  <td><div class="person"><div class="mini">DF</div><div><strong>Dániel Farkas</strong><span>daniel.farkas@company.com</span></div></div></td>
                  <td>Backend Developer</td>
                  <td><div class="badges"><span class="badge">Engineering</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Réka Varga" data-role="Account Executive" data-groups="Sales, Remote" data-status="Active">
                  <td><div class="person"><div class="mini">RV</div><div><strong>Réka Varga</strong><span>reka.varga@company.com</span></div></div></td>
                  <td>Account Executive</td>
                  <td><div class="badges"><span class="badge">Sales</span><span class="badge">Remote</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Máté Horváth" data-role="QA Engineer" data-groups="Engineering, Product" data-status="Invited">
                  <td><div class="person"><div class="mini">MH</div><div><strong>Máté Horváth</strong><span>mate.horvath@company.com</span></div></div></td>
                  <td>QA Engineer</td>
                  <td><div class="badges"><span class="badge">Engineering</span><span class="badge">Product</span></div></td>
                  <td><span class="status invited">Invited</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Lilla Kovács" data-role="People Partner" data-groups="People Ops, Managers" data-status="Active">
                  <td><div class="person"><div class="mini">LK</div><div><strong>Lilla Kovács</strong><span>lilla.kovacs@company.com</span></div></div></td>
                  <td>People Partner</td>
                  <td><div class="badges"><span class="badge">People Ops</span><span class="badge">Managers</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Gábor Szabó" data-role="Product Manager" data-groups="Product, Managers" data-status="Active">
                  <td><div class="person"><div class="mini">GS</div><div><strong>Gábor Szabó</strong><span>gabor.szabo@company.com</span></div></div></td>
                  <td>Product Manager</td>
                  <td><div class="badges"><span class="badge">Product</span><span class="badge">Managers</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Zsófia Nagy" data-role="Customer Success Manager" data-groups="Sales" data-status="Active">
                  <td><div class="person"><div class="mini">ZN</div><div><strong>Zsófia Nagy</strong><span>zsofia.nagy@company.com</span></div></div></td>
                  <td>Customer Success Manager</td>
                  <td><div class="badges"><span class="badge">Sales</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
                <tr data-name="Péter Kiss" data-role="Data Analyst" data-groups="Product, Remote" data-status="Active">
                  <td><div class="person"><div class="mini">PK</div><div><strong>Péter Kiss</strong><span>peter.kiss@company.com</span></div></div></td>
                  <td>Data Analyst</td>
                  <td><div class="badges"><span class="badge">Product</span><span class="badge">Remote</span></div></td>
                  <td><span class="status active">Active</span></td>
                  <td><a class="link" href="#">Edit</a></td>
                </tr>
              </tbody>
            </table>
            <div class="table-footer">
              <span id="employeeCount">Showing employees</span>
              <div class="pager"><button id="prevPage" type="button">← Previous</button><span id="pageInfo"></span><button id="nextPage" type="button">Next →</button></div>
            </div>
          </div>
        </div>

        <aside>
          <div class="side-card">
            <h3>Groups</h3>
            <div class="group-row"><div><strong>Engineering</strong><span>Department group</span></div><div class="count">42</div></div>
            <div class="group-row"><div><strong>Managers</strong><span>Role-based group</span></div><div class="count">14</div></div>
            <div class="group-row"><div><strong>Product</strong><span>Department group</span></div><div class="count">18</div></div>
            <div class="group-row"><div><strong>Remote</strong><span>Custom group</span></div><div class="count">27</div></div>
            <button class="btn" id="manageGroupsBtn" style="width:100%;margin-top:12px">Manage groups</button>
          </div>
        </aside>
      </section>
    </main>
  </div>

  <div class="modal-backdrop" id="employeeModal" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="employeeModalTitle">
      <div class="modal-head">
        <div>
          <h2 id="employeeModalTitle">Add employee</h2>
          <p>Add one employee manually or upload multiple employees from Excel.</p>
        </div>
        <button class="close" id="closeEmployeeModal" type="button">×</button>
      </div>
      <div class="modal-body">
        <div class="add-tabs">
          <button class="add-tab active" type="button" data-panel="manualPanel">Manual entry</button>
          <button class="add-tab" type="button" data-panel="excelPanel">Excel upload</button>
        </div>
        <div class="panel active" id="manualPanel">
          <div class="form-grid">
            <div class="field"><label>Full name</label><input placeholder="e.g. Anna Molnár" /></div>
            <div class="field"><label>Role</label><input placeholder="e.g. Engineering Manager" /></div>
            <div class="field full"><label>Email address</label><input type="email" placeholder="anna.molnar@company.com" /></div>
            <div class="field full"><label>Groups</label><div class="group-checks"><label><input type="checkbox" /> Engineering</label><label><input type="checkbox" /> Managers</label><label><input type="checkbox" /> Product</label><label><input type="checkbox" /> Sales</label><label><input type="checkbox" /> Remote</label></div></div>
          </div>
          <div class="modal-actions"><button class="btn" type="button" id="cancelManual">Cancel</button><button class="btn primary" type="button">Save employee</button></div>
        </div>
        <div class="panel" id="excelPanel">
          <div class="upload-box">
            <strong>Upload Excel file</strong>
            <p>Use an .xlsx file with columns: name, role, email, groups.</p>
            <label class="file-picker"><input type="file" accept=".xlsx,.xls,.csv" /><span>Choose Excel file</span></label>
          </div>
          <div class="modal-actions"><button class="btn" type="button">Download template</button><button class="btn primary" type="button">Upload employees</button></div>
        </div>
      </div>
    </div>
  </div>

  <div class="modal-backdrop" id="groupsModal" aria-hidden="true">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="groupsModalTitle">
      <div class="modal-head">
        <div>
          <h2 id="groupsModalTitle">Manage groups</h2>
          <p>Create groups manually or import group names and descriptions from Excel.</p>
        </div>
        <button class="close" id="closeGroupsModal" type="button">×</button>
      </div>
      <div class="modal-body">
        <div class="add-tabs">
          <button class="add-tab active" type="button" data-panel="groupManualPanel">Manual group</button>
          <button class="add-tab" type="button" data-panel="groupExcelPanel">Excel import</button>
        </div>
        <div class="panel active" id="groupManualPanel">
          <div class="form-grid">
            <div class="field full"><label>Group name</label><input id="groupNameInput" placeholder="e.g. Engineering" value="Engineering" /></div>
            <div class="field full"><label>Description</label><textarea id="groupDescriptionInput" placeholder="Describe who belongs to this group and when it should be used…">Developers, QA and engineering managers.</textarea></div>
          </div>
          <div class="group-manager-tools">
            <strong>Existing groups</strong>
            <input id="groupSearch" placeholder="Search groups…" />
          </div>
          <div class="group-manager-list" id="groupManagerList">
            <button class="group-manager-row active" type="button" data-group="Engineering"><strong>Engineering</strong><span>Developers, QA and engineering managers.</span></button>
            <button class="group-manager-row" type="button" data-group="Managers"><strong>Managers</strong><span>People managers included in manager feedback workflows.</span></button>
            <button class="group-manager-row" type="button" data-group="Product"><strong>Product</strong><span>Product managers, designers and product analysts.</span></button>
            <button class="group-manager-row" type="button" data-group="Remote"><strong>Remote</strong><span>Employees working mainly remotely.</span></button>
            <button class="group-manager-row" type="button" data-group="Sales"><strong>Sales</strong><span>Sales and account management team.</span></button>
            <button class="group-manager-row" type="button" data-group="Design"><strong>Design</strong><span>Product and brand designers.</span></button>
            <button class="group-manager-row" type="button" data-group="People Ops"><strong>People Ops</strong><span>HR and people operations team.</span></button>
            <button class="group-manager-row" type="button" data-group="Customer Success"><strong>Customer Success</strong><span>Customer-facing success managers.</span></button>
            <button class="group-manager-row" type="button" data-group="Leadership"><strong>Leadership</strong><span>Company leadership and senior decision makers.</span></button>
            <button class="group-manager-row" type="button" data-group="New Joiners"><strong>New Joiners</strong><span>Employees who joined in the last 90 days.</span></button>
          </div>
          <div class="table-footer">
            <span id="groupCount">Showing groups</span>
            <div class="pager"><button id="prevGroupPage" type="button">← Previous</button><span id="groupPageInfo"></span><button id="nextGroupPage" type="button">Next →</button></div>
          </div>
          <div class="members-box">
            <h4 id="selectedGroupTitle">Engineering members</h4>
            <div class="member-list" id="groupMembers"></div>
          </div>
          <div class="modal-actions"><button class="btn" type="button" id="cancelGroups">Cancel</button><button class="btn primary" type="button">Save group</button></div>
        </div>
        <div class="panel" id="groupExcelPanel">
          <div class="upload-box">
            <strong>Import groups from Excel</strong>
            <p>Use an .xlsx file with columns: group name, description.</p>
            <label class="file-picker"><input type="file" accept=".xlsx,.xls,.csv" /><span>Choose Excel file</span></label>
          </div>
          <div class="modal-actions"><button class="btn" type="button">Download template</button><button class="btn primary" type="button">Import groups</button></div>
        </div>
      </div>
    </div>
  </div>
`;

export default function People() {
  const navigate = useNavigate();

  useEffect(() => {
    const $ = id => document.getElementById(id);

    // Navigáció – a cél a HTML-ben, data-link attribútumban van
    document.querySelectorAll('.nav-item[data-link]').forEach(item => {
      item.style.cursor = 'pointer';
      item.setAttribute('role', 'link');
      item.tabIndex = 0;
      item.onclick = () => navigate(item.dataset.link);
      item.onkeydown = e => { if (e.key === 'Enter') item.click(); };
    });

    // Modálok
    const modal = $('employeeModal');
    const groupsModal = $('groupsModal');
    const closeModal = () => modal.classList.remove('open');
    const closeGroupsModal = () => groupsModal.classList.remove('open');
    $('addEmployeeBtn').onclick = () => modal.classList.add('open');
    $('manageGroupsBtn').onclick = () => groupsModal.classList.add('open');
    $('closeEmployeeModal').onclick = closeModal;
    $('cancelManual').onclick = closeModal;
    $('closeGroupsModal').onclick = closeGroupsModal;
    $('cancelGroups').onclick = closeGroupsModal;
    modal.onclick = e => { if (e.target === modal) closeModal(); };
    groupsModal.onclick = e => { if (e.target === groupsModal) closeGroupsModal(); };
    document.querySelectorAll('.add-tab').forEach(tab => tab.onclick = () => {
      const root = tab.closest('.modal');
      root.querySelectorAll('.add-tab').forEach(t => t.classList.remove('active'));
      root.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      root.querySelector('#' + tab.dataset.panel).classList.add('active');
    });

    // Lapozás segéd: a megadott elemek közül csak az aktuális oldalét mutatja
    const paginate = (items, page, size) => {
      const pages = Math.max(1, Math.ceil(items.length / size));
      page = Math.min(Math.max(page, 1), pages);
      const start = (page - 1) * size;
      items.forEach((el, i) => { el.style.display = i >= start && i < start + size ? '' : 'none'; });
      const shown = Math.max(0, Math.min(size, items.length - start));
      return { page, pages, from: items.length ? start + 1 : 0, to: start + shown };
    };

    // Munkatársak táblázat – a sorok a HTML-ben vannak, itt csak rendezés + lapozás
    const tbody = $('employeeRows');
    let sortKey = 'name', sortDir = 'asc', page = 1;
    const renderEmployees = () => {
      const rows = [...tbody.querySelectorAll('tr')].sort((a, b) =>
        a.dataset[sortKey].localeCompare(b.dataset[sortKey], 'hu') * (sortDir === 'asc' ? 1 : -1));
      rows.forEach(r => tbody.appendChild(r));
      const p = paginate(rows, page, 7);
      page = p.page;
      $('employeeCount').textContent = `Showing ${p.from}–${p.to} of ${rows.length} employees`;
      $('pageInfo').textContent = `Page ${p.page} / ${p.pages}`;
      $('prevPage').disabled = p.page === 1;
      $('nextPage').disabled = p.page === p.pages;
      document.querySelectorAll('[data-sort]').forEach(b => {
        b.classList.toggle('active', b.dataset.sort === sortKey);
        b.classList.toggle('asc', b.dataset.sort === sortKey && sortDir === 'asc');
      });
    };
    document.querySelectorAll('[data-sort]').forEach(btn => btn.onclick = () => {
      if (sortKey === btn.dataset.sort) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortKey = btn.dataset.sort; sortDir = 'asc'; }
      page = 1;
      renderEmployees();
    });
    $('prevPage').onclick = () => { page--; renderEmployees(); };
    $('nextPage').onclick = () => { page++; renderEmployees(); };
    renderEmployees();

    // Csoportkezelő – a csoportok a HTML-ben vannak, itt keresés, lapozás, kiválasztás
    const groupList = $('groupManagerList');
    const groupSearch = $('groupSearch');
    let groupPage = 1;
    const renderMembers = name => {
      const members = [...tbody.querySelectorAll('tr')]
        .filter(r => r.dataset.groups.split(', ').includes(name))
        .map(r => r.dataset.name);
      $('selectedGroupTitle').textContent = `${name} members`;
      $('groupMembers').innerHTML = members.length
        ? members.map(n => `<span class="member-chip">${n}</span>`).join('')
        : '<span class="member-chip">No employees in this group yet</span>';
    };
    const renderGroups = () => {
      const term = groupSearch.value.toLowerCase();
      const all = [...groupList.querySelectorAll('[data-group]')];
      all.forEach(b => b.style.display = 'none');
      const filtered = all.filter(b => b.textContent.toLowerCase().includes(term));
      const p = paginate(filtered, groupPage, 5);
      groupPage = p.page;
      $('groupCount').textContent = `Showing ${p.from}–${p.to} of ${filtered.length} groups`;
      $('groupPageInfo').textContent = `Page ${p.page} / ${p.pages}`;
      $('prevGroupPage').disabled = p.page === 1;
      $('nextGroupPage').disabled = p.page === p.pages;
    };
    groupList.querySelectorAll('[data-group]').forEach(b => b.onclick = () => {
      groupList.querySelectorAll('[data-group]').forEach(x => x.classList.toggle('active', x === b));
      $('groupNameInput').value = b.querySelector('strong').textContent;
      $('groupDescriptionInput').value = b.querySelector('span').textContent;
      renderMembers(b.dataset.group);
    });
    groupSearch.oninput = () => { groupPage = 1; renderGroups(); };
    $('prevGroupPage').onclick = () => { groupPage--; renderGroups(); };
    $('nextGroupPage').onclick = () => { groupPage++; renderGroups(); };
    renderGroups();
    renderMembers('Engineering');
  }, [navigate]);

  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}