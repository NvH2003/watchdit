import { TouchableOpacity, Image, Text, View, StyleSheet } from 'react-native';
import { posterUrl } from '@/lib/tmdb';

interface ShowGridCardProps {
  name: string;
  posterPath: string | null | undefined;
  unwatchedCount?: number;
  onPress: () => void;
}

export default function ShowGridCard({
  name,
  posterPath,
  unwatchedCount,
  onPress,
}: ShowGridCardProps) {
  const poster = posterUrl(posterPath, 'w342');

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
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
  poster: {
    width: '100%',
    aspectRatio: 2 / 3,
    borderRadius: 8,
    backgroundColor: '#252840',
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
    backgroundColor: '#e94560',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  name: {
    color: '#fff',
    fontSize: 13,
    marginTop: 8,
    fontWeight: '500',
    lineHeight: 18,
  },
});
