import { KeyRound, RefreshCw, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import {
  clearAdminUserDevices,
  createAdminUser,
  deleteAdminUser,
  loadAdminUsers,
  resetAdminUserPassword,
  type AdminDevice,
  type AdminUser
} from '../services/api';

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  const refresh = async () => {
    const payload = await loadAdminUsers();
    setUsers(payload.users);
    setDevices(payload.devices);
  };

  useEffect(() => {
    refresh().catch(err => setError(err instanceof Error ? err.message : '后台数据读取失败'));
  }, []);

  const devicesByUser = useMemo(() => {
    const map = new Map<string, AdminDevice[]>();
    for (const device of devices) {
      if (!map.has(device.user_id)) map.set(device.user_id, []);
      map.get(device.user_id)?.push(device);
    }
    return map;
  }, [devices]);

  const run = async (task: () => Promise<unknown>, success: string) => {
    setWorking(true);
    setMessage('');
    setError('');
    try {
      const result = await task();
      if (result && typeof result === 'object' && 'users' in result && 'devices' in result) {
        setUsers((result as { users: AdminUser[] }).users);
        setDevices((result as { devices: AdminDevice[] }).devices);
      } else {
        await refresh();
      }
      setMessage(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setWorking(false);
    }
  };

  const submitUser = (event: FormEvent) => {
    event.preventDefault();
    void run(() => createAdminUser(username, password), '账户已创建').then(() => {
      setUsername('');
      setPassword('');
    });
  };

  const clearDevices = (target: AdminUser) => {
    const ok = window.confirm([
      '确认清空设备记录？',
      `账户：${target.username}`,
      '清空后该账户需要重新登录绑定设备。'
    ].join('\n'));
    if (!ok) return;
    void run(() => clearAdminUserDevices(target.id), `${target.username} 的设备记录已清空`);
  };

  const resetPassword = (target: AdminUser) => {
    const ok = window.confirm([
      '确认重置密码？',
      `账户：${target.username}`,
      '新密码将被设置为：12345678',
      '该账户当前登录状态会失效。'
    ].join('\n'));
    if (!ok) return;
    void run(() => resetAdminUserPassword(target.id), `${target.username} 的密码已重置为 12345678`);
  };

  const removeUser = (target: AdminUser) => {
    const ok = window.confirm([
      '确认删除账户？',
      `账户：${target.username}`,
      '该账户的设备、学习进度、错题和自定义词库会被清除。',
      '此操作无法撤销。'
    ].join('\n'));
    if (!ok) return;
    void run(() => deleteAdminUser(target.id), `${target.username} 已删除`);
  };

  return (
    <main className="content-section page-section admin-page">
      <div className="page-heading">
        <p className="eyebrow">ROOT ADMIN</p>
        <h1>后台管理</h1>
        <p>这里管理账户和登录设备。公共 N5-N4 等开源词库由 root 在“词库”页面维护，普通用户只维护自己的自定义词库。</p>
      </div>

      {(message || error) && <p className={error ? 'admin-error' : 'admin-success'}>{error || message}</p>}

      <section className="admin-summary" aria-label="后台统计">
        <div><Users size={20} /><span>账户</span><strong>{users.length}</strong></div>
        <div><ShieldCheck size={20} /><span>登录设备</span><strong>{devices.length}</strong></div>
      </section>

      <section className="admin-panel">
        <div className="section-title"><h2>新增账户</h2><span>每个账户有独立词库和学习进度</span></div>
        <form className="admin-create-form" onSubmit={submitUser}>
          <label><span>用户名</span><input value={username} onChange={event => setUsername(event.target.value)} placeholder="3-32 位字母、数字、下划线" /></label>
          <label><span>初始密码</span><input value={password} onChange={event => setPassword(event.target.value)} type="password" placeholder="至少 8 位" /></label>
          <button type="submit" disabled={working || !username || !password}><UserPlus size={17} />添加账户</button>
          <button type="button" className="muted" disabled={working} onClick={() => void run(refresh, '数据已刷新')}><RefreshCw size={17} />刷新</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="section-title"><h2>账户列表</h2><span>{users.length} 个账户</span></div>
        <div className="admin-user-list">
          {users.map(user => (
            <article key={user.id}>
              <div className="admin-user-main">
                <strong><span className={Number(user.session_count || 0) > 0 ? 'admin-status-dot online' : 'admin-status-dot offline'} />{user.username}</strong>
                <span>创建 {user.created_at || '-'} · 最近登录 {user.last_login_at || '-'}</span>
                <small>{(devicesByUser.get(user.id) || []).map(device => device.device_name || device.device_id).join('、') || '暂无设备'}</small>
              </div>
              <span className={Number(user.session_count || 0) > 0 ? 'admin-status-pill online' : 'admin-status-pill offline'}>{Number(user.session_count || 0) > 0 ? '在线' : '离线'}</span>
              <b>{user.device_count} 设备</b>
              <button type="button" disabled={working} onClick={() => clearDevices(user)}>清空设备</button>
              <button type="button" className="muted" disabled={working} onClick={() => resetPassword(user)}><KeyRound size={16} />重置密码</button>
              {user.username !== 'root' && <button type="button" className="danger" disabled={working} onClick={() => removeUser(user)}><Trash2 size={16} />删除</button>}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
