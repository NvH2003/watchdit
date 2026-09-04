import { TouchableOpacity, Image, Text, View, StyleSheet } from 'react-native';
import { posterUrl } from '@/lib/tmdb';
import { theme } from '@/constants/theme';

interface ShowGridCardProps {
  name: string;
  posterPath: string | null | undefined;
  unwatchedCount?: number;
  watchedCount?: number;
  totalEpisodes?: number;
  onPress: () => void;
}

export default function ShowGridCard({
  name,
  posterPath,
  unwatchedCount,
  watchedCount,
  totalEpisodes,
  onPress,
}: ShowGridCardProps) {
  const poster = posterUrl(posterPath, 'w342');
  const progress =
    totalEpisodes && totalEpisodes > 0 && watchedCount != null
      ? Math.min(watchedCount / totalEpisodes, 1)
      : null;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.posterWrapper}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" />
        ) : (
          <View style={[styles.poster, styles.placeholder]}>
            <Text style={styles.placeholderEmoji}>📺</Text>
          </View>
        )}
        {unwatchedCount && unwatchedCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unwatchedCount}</Text>
          </View>
        ) : null}
        {progress !== null && (
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: progress >= 1 ? theme.check : theme.gold }]} />
          </View>
        )}
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {name}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 112,
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 4,
  },
  posterWrapper: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: theme.elevated,
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderEmoji: {
    fontSize: 28,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: theme.accent,
    borderRadius: 10,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: {
    color: theme.text,
    fontSize: 11,
    fontWeight: '700',
  },
  progressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.gold,
  },
  name: {
    color: theme.text,
    fontSize: 12,
    marginTop: 6,
    fontWeight: '500',
    lineHeight: 16,
  },
});
