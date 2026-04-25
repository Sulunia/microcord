import styles from './members-sidebar.module.css';

function MemberItem({ user, isOnline }) {
  const name = user?.display_name || user?.name || 'Unknown';
  const initial = name.charAt(0).toUpperCase();
  const hasAvatar = Boolean(user?.avatar_url);

  return (
    <div class={`${styles.member} ${isOnline ? styles.online : styles.offline}`}>
      <span class={styles.avatar}>
        {hasAvatar ? (
          <img src={user.avatar_url} alt={name} class={styles.avatarImg} />
        ) : (
          <span>{initial}</span>
        )}
        <span class={`${styles.statusDot} ${isOnline ? styles.statusOnline : styles.statusOffline}`} />
      </span>
      <span class={styles.memberName}>{name}</span>
    </div>
  );
}

export function MembersSidebar({ usersMap, onlineUserIds }) {
  const allUsers = Object.values(usersMap);
  const onlineSet = onlineUserIds || new Set();

  const online = allUsers.filter((u) => onlineSet.has(u.id));
  const offline = allUsers.filter((u) => !onlineSet.has(u.id));

  return (
    <aside class={styles.sidebar}>
      <div class={`${styles.scrollArea} has-scrollbar`}>
        {online.length > 0 && (
          <div class={styles.group}>
            <div class={styles.groupHeader}>Online — {online.length}</div>
            {online.map((u) => (
              <MemberItem key={u.id} user={u} isOnline={true} />
            ))}
          </div>
        )}
        {offline.length > 0 && (
          <div class={styles.group}>
            <div class={styles.groupHeader}>Offline — {offline.length}</div>
            {offline.map((u) => (
              <MemberItem key={u.id} user={u} isOnline={false} />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
