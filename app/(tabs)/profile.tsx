import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useRouter } from 'expo-router';
import db from '@/lib/db';

type ShowStatus = 'watching' | 'watchLater' | 'finished' | 'upToDate';

const STATUS_CONFIG: { key: ShowStatus; label: string; color: string }[] = [
  { key: 'watching', label: 'Watching', color: '#e94560' },
  { key: 'upToDate', label: 'Up to Date', color: '#4caf50' },
  { key: 'watchLater', label: 'Watch Later', color: '#f5a623' },
  { key: 'finished', label: 'Finished', color: '#8892a4' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { user } = db.useAuth();

  const { data } = db.useQuery(
    user
      ? {
          userShows: { $: { where: { '$user.id': user.id } } },
          watchedEpisodes: { $: { where: { '$user.id': user.id } } },
        }
      : null
  );

  const shows = data?.userShows ?? [];
  const watchedEpisodes = data?.watchedEpisodes ?? [];

  const grouped = Object.fromEntries(
    STATUS_CONFIG.map(s => [
      s.key,
      shows.filter(show => show.status === s.key),
    ])
  ) as Record<ShowStatus, typeof shows>;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </Text>
          </View>
          <Text style={styles.email} numberOfLines={1}>
            {user?.email}
          </Text>
          <TouchableOpacity
            style={styles.signOutBtn}
            onPress={() => db.auth.signOut()}
          >
            <Text style={styles.signOutText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <StatBox label="Shows" value={shows.length} />
          <StatBox label="Episodes Watched" value={watchedEpisodes.length} />
          <StatBox
            label="Watching"
            value={grouped.watching?.length ?? 0}
          />
        </View>

        <View style={styles.statusGrid}>
          {STATUS_CONFIG.map(({ key, label, color }) => {
            const count = grouped[key]?.length ?? 0;
            return (
              <View key={key} style={[styles.statusCard, { borderLeftColor: color }]}>
                <Text style={[styles.statusCount, { color }]}>{count}</Text>
                <Text style={styles.statusLabel}>{label}</Text>
              </View>
            );
          })}
        </View>

        {STATUS_CONFIG.map(({ key, label, color }) => {
          const list = grouped[key] ?? [];
          if (list.length === 0) return null;
          return (
            <View key={key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionDot, { backgroundColor: color }]} />
                <Text style={styles.sectionTitle}>
                  {label}
                </Text>
                <Text style={styles.sectionCount}>{list.length}</Text>
              </View>
              {list.map(show => (
                <TouchableOpacity
                  key={show.id}
                  style={styles.showItem}
                  onPress={() => router.push(`/show/${show.tmdbShowId}`)}
                >
                  <Text style={styles.showName} numberOfLines={1}>
                    {show.tmdbShowName as string}
                  </Text>
                  <Text style={styles.showChevron}>›</Text>
                </TouchableOpacity>
              ))}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatBox({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0f14',
  },
  content: {
    paddingBottom: 48,
  },
  header: {
    alignItems: 'center',
    paddingTop: 32,
    paddingBottom: 28,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1f2e',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e94560',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarText: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '700',
  },
  email: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 18,
    maxWidth: '80%',
  },
  signOutBtn: {
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e94560',
  },
  signOutText: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '500',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1f2e',
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    color: '#fff',
    fontSize: 30,
    fontWeight: '700',
  },
  statLabel: {
    color: '#8892a4',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1f2e',
  },
  statusCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#1c1f2e',
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 3,
  },
  statusCount: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 2,
  },
  statusLabel: {
    color: '#8892a4',
    fontSize: 12,
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  sectionTitle: {
    color: '#8892a4',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    flex: 1,
  },
  sectionCount: {
    color: '#8892a4',
    fontSize: 12,
  },
  showItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1f2e',
  },
  showName: {
    color: '#fff',
    fontSize: 15,
    flex: 1,
  },
  showChevron: {
    color: '#8892a4',
    fontSize: 20,
  },
});
