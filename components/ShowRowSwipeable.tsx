import { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
} from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { posterUrl } from '@/lib/tmdb';

export type ShowStatus = 'watching' | 'watchLater' | 'finished' | 'upToDate';

interface ShowRowProps {
  id: string;
  name: string;
  posterPath: string | null;
  status: ShowStatus;
  unwatchedCount?: number;
  nextEpisodeLabel?: string;
  onPress: () => void;
  onStatusChange: (id: string, status: ShowStatus) => void;
  onRemove: (id: string) => void;
}

function RightActions({
  onWatchLater,
  onRemove,
}: {
  onWatchLater: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.rightActions}>
      <TouchableOpacity
        style={[styles.actionBtn, styles.watchLaterBtn]}
        onPress={onWatchLater}
      >
        <Text style={styles.actionText}>Later</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.actionBtn, styles.removeBtn]}
        onPress={onRemove}
      >
        <Text style={styles.actionText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

function RowContent({
  name,
  posterPath,
  unwatchedCount,
  nextEpisodeLabel,
}: Pick<ShowRowProps, 'name' | 'posterPath' | 'unwatchedCount' | 'nextEpisodeLabel'>) {
  const poster = posterUrl(posterPath, 'w185');
  return (
    <>
      {poster ? (
        <Image source={{ uri: poster }} style={styles.poster} />
      ) : (
        <View style={[styles.poster, styles.posterPlaceholder]}>
          <Text style={styles.posterEmoji}>📺</Text>
        </View>
      )}
      <View style={styles.info}>
        <Text style={styles.showName} numberOfLines={1}>
          {name}
        </Text>
        {nextEpisodeLabel ? (
          <Text style={styles.episode} numberOfLines={1}>
            {nextEpisodeLabel}
          </Text>
        ) : null}
      </View>
      {(unwatchedCount ?? 0) > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unwatchedCount}</Text>
        </View>
      )}
    </>
  );
}

export default function ShowRowSwipeable({
  id,
  name,
  posterPath,
  status,
  unwatchedCount,
  nextEpisodeLabel,
  onPress,
  onStatusChange,
  onRemove,
}: ShowRowProps) {
  const swipeRef = useRef<Swipeable>(null);

  function handleWatchLater() {
    swipeRef.current?.close();
    onStatusChange(id, 'watchLater');
  }

  function handleRemove() {
    swipeRef.current?.close();
    onRemove(id);
  }

  if (Platform.OS === 'web') {
    return (
      <View style={styles.rowWebWrapper}>
        <TouchableOpacity style={styles.row} onPress={onPress}>
          <RowContent
            name={name}
            posterPath={posterPath}
            unwatchedCount={unwatchedCount}
            nextEpisodeLabel={nextEpisodeLabel}
          />
        </TouchableOpacity>
        <View style={styles.webActions}>
          <TouchableOpacity
            style={styles.webBtn}
            onPress={() => onStatusChange(id, 'watchLater')}
          >
            <Text style={styles.webBtnText}>Later</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.webBtn, styles.webBtnRemove]}
            onPress={() => onRemove(id)}
          >
            <Text style={styles.webBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={() => (
        <RightActions onWatchLater={handleWatchLater} onRemove={handleRemove} />
      )}
      friction={2}
      rightThreshold={40}
    >
      <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.85}>
        <RowContent
          name={name}
          posterPath={posterPath}
          unwatchedCount={unwatchedCount}
          nextEpisodeLabel={nextEpisodeLabel}
        />
      </TouchableOpacity>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  rowWebWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1f2e',
    borderBottomWidth: 1,
    borderBottomColor: '#252840',
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1c1f2e',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#252840',
  },
  poster: {
    width: 48,
    height: 72,
    borderRadius: 6,
    marginRight: 14,
  },
  posterPlaceholder: {
    backgroundColor: '#252840',
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterEmoji: {
    fontSize: 20,
  },
  info: {
    flex: 1,
    justifyContent: 'center',
  },
  showName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  episode: {
    color: '#8892a4',
    fontSize: 13,
  },
  badge: {
    backgroundColor: '#e94560',
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginLeft: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  rightActions: {
    flexDirection: 'row',
  },
  actionBtn: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  watchLaterBtn: {
    backgroundColor: '#f5a623',
  },
  removeBtn: {
    backgroundColor: '#e94560',
  },
  actionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  webActions: {
    flexDirection: 'row',
    gap: 6,
    paddingRight: 12,
  },
  webBtn: {
    backgroundColor: '#f5a623',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  webBtnRemove: {
    backgroundColor: '#e94560',
  },
  webBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
