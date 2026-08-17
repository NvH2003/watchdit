import { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Image,
  Modal,
  Pressable,
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
        <Text style={styles.actionEmoji}>⏱</Text>
        <Text style={styles.actionText}>Later</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.actionBtn, styles.removeBtn]} onPress={onRemove}>
        <Text style={styles.actionEmoji}>✕</Text>
        <Text style={styles.actionText}>Remove</Text>
      </TouchableOpacity>
    </View>
  );
}

function WebMenu({
  visible,
  onClose,
  onWatchLater,
  onRemove,
}: {
  visible: boolean;
  onClose: () => void;
  onWatchLater: () => void;
  onRemove: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.menuOverlay} onPress={onClose}>
        <View style={styles.menuBox}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => { onWatchLater(); onClose(); }}
          >
            <Text style={styles.menuItemText}>⏱  Watch Later</Text>
          </TouchableOpacity>
          <View style={styles.menuDivider} />
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => { onRemove(); onClose(); }}
          >
            <Text style={[styles.menuItemText, styles.menuItemDanger]}>✕  Remove</Text>
          </TouchableOpacity>
        </View>
      </Pressable>
    </Modal>
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
  const [menuOpen, setMenuOpen] = useState(false);
  const poster = posterUrl(posterPath, 'w185');

  const season = nextSeasonNum ?? 1;
  const episode = nextEpisodeNum ?? 1;
  const epCode = `S${String(season).padStart(2, '0')} | E${String(episode).padStart(2, '0')}`;
  const remaining = remainingCount ?? 0;

  function handleWatchLater() {
    swipeRef.current?.close();
    onStatusChange(id, 'watchLater');
  }
  function handleRemove() {
    swipeRef.current?.close();
    onRemove(id);
  }

  const rowContent = (
    <View style={styles.row}>
      {/* Poster */}
      <TouchableOpacity onPress={onShowPress} activeOpacity={0.8}>
        {poster ? (
          <Image source={{ uri: poster }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]}>
            <Text style={styles.posterEmoji}>📺</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Info */}
      <View style={styles.info}>
        <TouchableOpacity style={styles.showPill} onPress={onShowPress} activeOpacity={0.7}>
          <Text style={styles.showPillText} numberOfLines={1}>
            {name.toUpperCase()}
          </Text>
          <Text style={styles.showPillArrow}> ›</Text>
        </TouchableOpacity>

        <View style={styles.epRow}>
          <Text style={styles.epCode}>{epCode}</Text>
          {remaining > 0 && (
            <Text style={styles.remaining}> +{remaining}</Text>
          )}
        </View>

        {nextEpisodeName ? (
          <Text style={styles.epName} numberOfLines={1}>{nextEpisodeName}</Text>
        ) : null}
      </View>

      {/* Right side actions */}
      <View style={styles.rightSide}>
        {Platform.OS === 'web' && (
          <TouchableOpacity
            style={styles.menuBtn}
            onPress={() => setMenuOpen(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.menuBtnText}>⋯</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.checkBtn, status === 'upToDate' && styles.checkBtnDone]}
          onPress={onCheckPress}
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.checkIcon}>✓</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  if (Platform.OS === 'web') {
    return (
      <>
        {rowContent}
        <WebMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          onWatchLater={() => onStatusChange(id, 'watchLater')}
          onRemove={() => onRemove(id)}
        />
      </>
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
      {rowContent}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#13141f',
    paddingVertical: 12,
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
    justifyContent: 'center',
  },
  showPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#1e2030',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '90%',
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
  },
  rightSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  menuBtn: {
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuBtnText: {
    color: '#8892a4',
    fontSize: 20,
    letterSpacing: 1,
  },
  checkBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4caf50',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkBtnDone: {
    backgroundColor: '#2a2d3e',
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
  actionEmoji: {
    color: '#fff',
    fontSize: 16,
  },
  actionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuBox: {
    backgroundColor: '#1e2030',
    borderRadius: 14,
    overflow: 'hidden',
    width: 220,
    borderWidth: 1,
    borderColor: '#252840',
  },
  menuItem: {
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  menuItemText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '500',
  },
  menuItemDanger: {
    color: '#e94560',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#252840',
  },
});
