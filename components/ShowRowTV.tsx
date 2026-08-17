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

interface ShowRowTVProps {
  id: string;
  name: string;
  posterPath: string | null | undefined;
  status: ShowStatus;
  nextSeasonNum?: number | null;
  nextEpisodeNum?: number | null;
  nextEpisodeName?: string | null;
  remainingCount?: number;
  onShowPress: () => void;
  onCheckPress: () => void;
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
      <TouchableOpacity style={[styles.actionBtn, styles.watchLaterBtn]} onPress={onWatchLater}>
        <Text style={styles.actionIcon}>⏱</Text>
        <Text style={styles.actionText}>Later</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.actionBtn, styles.removeBtn]} onPress={onRemove}>
        <Text style={styles.actionIcon}>✕</Text>
        <Text style={styles.actionText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ShowRowTV({
  id,
  name,
  posterPath,
  status,
  nextSeasonNum,
  nextEpisodeNum,
  nextEpisodeName,
  remainingCount,
  onShowPress,
  onCheckPress,
  onStatusChange,
  onRemove,
}: ShowRowTVProps) {
  const swipeRef = useRef<Swipeable>(null);
  const poster = posterUrl(posterPath, 'w185');

  const hasNextEp = nextSeasonNum != null && nextEpisodeNum != null;
  const epCode = hasNextEp
    ? `S${String(nextSeasonNum).padStart(2, '0')} | E${String(nextEpisodeNum).padStart(2, '0')}`
    : null;

  function handleWatchLater() {
    swipeRef.current?.close();
    onStatusChange(id, 'watchLater');
  }

  function handleRemove() {
    swipeRef.current?.close();
    onRemove(id);
  }

  const inner = (
    <View style={styles.row}>
      <TouchableOpacity onPress={onShowPress} activeOpacity={0.85}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Text style={styles.posterEmoji}>📺</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.info}>
        <TouchableOpacity style={styles.showPill} onPress={onShowPress} activeOpacity={0.7}>
          <Text style={styles.showPillText} numberOfLines={1}>
            {name.toUpperCase()}
          </Text>
          <Text style={styles.showPillArrow}> ›</Text>
        </TouchableOpacity>

        {epCode ? (
          <View style={styles.epRow}>
            <Text style={styles.epCode}>{epCode}</Text>
            {(remainingCount ?? 0) > 0 && (
              <Text style={styles.remaining}> +{remainingCount}</Text>
            )}
          </View>
        ) : null}

        {nextEpisodeName ? (
          <Text style={styles.epName} numberOfLines={1}>
            {nextEpisodeName}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.checkBtn, status === 'upToDate' && styles.checkBtnDone]}
        onPress={onCheckPress}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={styles.checkIcon}>✓</Text>
      </TouchableOpacity>

      {Platform.OS === 'web' && (
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
      )}
    </View>
  );

  if (Platform.OS === 'web') {
    return inner;
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
      {inner}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#13141f',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e2030',
    gap: 12,
  },
  poster: {
    width: 52,
    height: 76,
    borderRadius: 6,
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
    gap: 5,
  },
  showPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#1e2030',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  showPillText: {
    color: '#c0c8d8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  showPillArrow: {
    color: '#8892a4',
    fontSize: 13,
  },
  epRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  epCode: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  remaining: {
    color: '#e94560',
    fontSize: 14,
    fontWeight: '600',
  },
  epName: {
    color: '#8892a4',
    fontSize: 13,
    lineHeight: 18,
  },
  checkBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4caf50',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  checkBtnDone: {
    backgroundColor: '#252840',
  },
  checkIcon: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 22,
  },
  rightActions: {
    flexDirection: 'row',
  },
  actionBtn: {
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  watchLaterBtn: {
    backgroundColor: '#f5a623',
  },
  removeBtn: {
    backgroundColor: '#e94560',
  },
  actionIcon: {
    color: '#fff',
    fontSize: 18,
  },
  actionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  webActions: {
    flexDirection: 'row',
    gap: 6,
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
