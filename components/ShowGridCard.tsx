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
          <Image source={{ uri: poster }} style={styles.poster} />
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
    flex: 1,
    marginBottom: 20,
    maxWidth: '48%',
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
    fontSize: 36,
  },
  badge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: theme.accent,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '700',
  },
  progressBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.gold,
  },
  name: {
    color: theme.text,
    fontSize: 13,
    marginTop: 8,
    fontWeight: '500',
    lineHeight: 18,
  },
});
