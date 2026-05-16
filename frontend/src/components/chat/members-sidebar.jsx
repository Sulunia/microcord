import { useState, useRef, useCallback } from 'preact/hooks';
import styles from './members-sidebar.module.css';

function MemberItem({ user, isOnline, isSelf, canAdmin, onAdminToggle }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const name = user?.display_name || 'Unknown';
  const initial = name.charAt(0).toUpperCase();
  const hasAvatar = Boolean(user?.avatar_url);

  const badge = user?.is_owner ? '\u{1F451}' : user?.is_admin ? '\u{2B50}' : null;

  const handleClick = useCallback((e) => {
    if (!canAdmin || user?.is_owner || isSelf) return;
    e.stopPropagation();
    setMenuOpen((v) => !v);
  }, [canAdmin, user?.is_owner, isSelf]);

  const handleAdminAction = useCallback((isAdmin) => {
    onAdminToggle(user.id, isAdmin);
    setMenuOpen(false);
  }, [user.id, onAdminToggle]);

  return (
    <div class={`${styles.member} ${isOnline ? styles.online : styles.offline}`} onClick={handleClick}>
      <span class={styles.avatar}>
        {hasAvatar ? (
          <img src={user.avatar_url} alt={name} class={styles.avatarImg} />
        ) : (
          <span>{initial}</span>
        )}
        <span class={`${styles.statusDot} ${isOnline ? styles.statusOnline : styles.statusOffline}`} />
      </span>
      <span class={styles.memberName}>{name}</span>
      {badge && <span class={styles.badge}>{badge}</span>}
      {menuOpen && canAdmin && !user?.is_owner && !isSelf && (
        <div ref={menuRef} class={styles.contextMenu} onClick={(e) => e.stopPropagation()}>
          {user?.is_admin ? (
            <button class={styles.contextMenuItem} onClick={() => handleAdminAction(false)}>Remove Admin</button>
          ) : (
            <button class={styles.contextMenuItem} onClick={() => handleAdminAction(true)}>Give Admin</button>
          )}
        </div>
      )}
    </div>
  );
}

export function MembersSidebar({ usersMap, onlineUserIds, currentUser, setUserAdmin }) {
  const allUsers = Object.values(usersMap);
  const onlineSet = onlineUserIds || new Set();

  const online = allUsers.filter((u) => onlineSet.has(u.id));
  const offline = allUsers.filter((u) => !onlineSet.has(u.id));

  const canAdmin = Boolean(currentUser?.is_admin || currentUser?.is_owner);

  return (
    <aside class={styles.sidebar}>
      <div class={`${styles.scrollArea} has-scrollbar`}>
        {online.length > 0 && (
          <div class={styles.group}>
            <div class={styles.groupHeader}>Online — {online.length}</div>
            {online.map((u) => (
              <MemberItem
                key={u.id}
                user={u}
                isOnline={true}
                isSelf={u.id === currentUser?.id}
                canAdmin={canAdmin}
                onAdminToggle={setUserAdmin}
              />
            ))}
          </div>
        )}
        {offline.length > 0 && (
          <div class={styles.group}>
            <div class={styles.groupHeader}>Offline — {offline.length}</div>
            {offline.map((u) => (
              <MemberItem
                key={u.id}
                user={u}
                isOnline={false}
                isSelf={u.id === currentUser?.id}
                canAdmin={canAdmin}
                onAdminToggle={setUserAdmin}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
