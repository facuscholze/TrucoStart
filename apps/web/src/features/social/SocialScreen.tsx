import type {
  AuthUserSummary,
  FriendListItem,
  FriendRequestListItem,
  PlayerSearchResult,
  RulesetCode,
  SocialInvitationItem,
  SocialNotificationEvent,
  SocialNotificationItem,
  SocialPresenceEvent,
} from '@truco/shared';
import { Avatar, Badge, CallButton } from '@truco/ui';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { ReportButton } from '../moderation/ReportButton.js';
import { messagesEsAr } from '../../i18n/messages.es-AR.js';
import {
  acceptFriendRequestRequest,
  acceptSocialInvitationRequest,
  blockUserRequest,
  cancelFriendRequestRequest,
  cancelSocialInvitationRequest,
  createDirectChallengeRequest,
  createFriendRequestRequest,
  declineFriendRequestRequest,
  declineSocialInvitationRequest,
  ensureGuestOrActiveSession,
  getUnreadSocialNotificationCountRequest,
  listBlockedUsersRequest,
  listFriendRequestsRequest,
  listFriendsRequest,
  listSocialInvitationsRequest,
  listSocialNotificationsRequest,
  markAllSocialNotificationsReadRequest,
  markSocialNotificationReadRequest,
  removeFriendRequest,
  searchPlayersRequest,
  unblockUserRequest,
} from '../../lib/api-client.js';
import { useSocialRealtimeEvents } from './SocialRealtimeProvider.js';

export interface SocialScreenProps {
  readonly currentUser: AuthUserSummary | null;
  readonly onSessionChanged: (user: AuthUserSummary | null) => void;
  readonly onNavigate: (path: string) => void;
}

function relationLabel(relationship: PlayerSearchResult['relationship']): string {
  const messages = messagesEsAr.social;
  if (relationship === 'FRIENDS') return messages.friendTag;
  if (relationship === 'PENDING_INCOMING') return messages.statusPendingIncoming;
  if (relationship === 'PENDING_OUTGOING') return messages.statusPendingOutgoing;
  return messages.statusNone;
}

export function SocialScreen({ currentUser, onSessionChanged, onNavigate }: SocialScreenProps) {
  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequestListItem[]>([]);
  const [incomingInvitations, setIncomingInvitations] = useState<SocialInvitationItem[]>([]);
  const [outgoingInvitations, setOutgoingInvitations] = useState<SocialInvitationItem[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<
    Array<{ userId: string; nickname: string; blockedAt: string }>
  >([]);
  const [notifications, setNotifications] = useState<SocialNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [searchResults, setSearchResults] = useState<PlayerSearchResult[]>([]);
  const [nicknameQuery, setNicknameQuery] = useState('');
  const [rulesetCode, setRulesetCode] = useState<RulesetCode>('ar-standard-v1');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadPanel = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setLoadError(null);
      try {
        const user = currentUser ?? (await ensureGuestOrActiveSession());
        if (!currentUser) onSessionChanged(user);
        const [
          friendsRes,
          requestsRes,
          incomingRes,
          outgoingRes,
          blocksRes,
          notificationsRes,
          countRes,
        ] = await Promise.all([
          listFriendsRequest(),
          listFriendRequestsRequest(),
          listSocialInvitationsRequest('INCOMING'),
          listSocialInvitationsRequest('OUTGOING'),
          listBlockedUsersRequest(),
          listSocialNotificationsRequest({ limit: 20 }),
          getUnreadSocialNotificationCountRequest(),
        ]);
        setFriends(friendsRes.items);
        setFriendRequests(requestsRes.items);
        setIncomingInvitations(incomingRes.items);
        setOutgoingInvitations(outgoingRes.items);
        setBlockedUsers(blocksRes.items);
        setNotifications(notificationsRes.items);
        setUnreadCount(countRes.unreadCount);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : messagesEsAr.social.actionError);
      } finally {
        setLoading(false);
      }
    },
    [currentUser, onSessionChanged],
  );

  useEffect(() => {
    void loadPanel();
  }, [loadPanel]);

  const handleNotification = useCallback(
    (event: SocialNotificationEvent) => {
      setNotifications((previous) => {
        if (previous.some((item) => item.id === event.id)) return previous;
        return [event, ...previous].slice(0, 20);
      });
      void loadPanel(false);
    },
    [loadPanel],
  );

  const handlePresence = useCallback((event: SocialPresenceEvent) => {
    setFriends((previous) =>
      previous.map((friend) => {
        if (friend.userId !== event.userId) return friend;
        if (!event.visible || event.status === 'OFFLINE') return { ...friend, presence: null };
        return { ...friend, presence: event.status };
      }),
    );
  }, []);

  const wsStatus = useSocialRealtimeEvents({
    onNotification: handleNotification,
    onPresence: handlePresence,
  });

  const withAction = useCallback(
    async (key: string, action: () => Promise<unknown>, success?: string) => {
      setBusyKey(key);
      setActionError(null);
      setToast(null);
      try {
        await action();
        if (success) setToast(success);
        await loadPanel(false);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : messagesEsAr.social.actionError);
      } finally {
        setBusyKey(null);
      }
    },
    [loadPanel],
  );

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const query = nicknameQuery.trim();
    if (query.length < 2) {
      setActionError(messagesEsAr.social.searchMinLength);
      return;
    }
    setSearching(true);
    setActionError(null);
    try {
      const result = await searchPlayersRequest(query);
      setSearchResults(result.items);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : messagesEsAr.social.actionError);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const acceptInvitation = async (invitation: SocialInvitationItem) => {
    setBusyKey(invitation.id);
    setActionError(null);
    try {
      const accepted = await acceptSocialInvitationRequest(invitation.id);
      setToast(messagesEsAr.social.invitationAccepted);
      onNavigate(`/sala/${accepted.table.id}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : messagesEsAr.social.actionError);
    } finally {
      setBusyKey(null);
    }
  };

  const renderInvitation = (
    invitation: SocialInvitationItem,
    direction: 'INCOMING' | 'OUTGOING',
  ) => (
    <li
      key={invitation.id}
      className="rounded-xl border border-ivory/15 bg-elevated p-3.5 space-y-3"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-ivory">
            {invitation.kind === 'CHALLENGE'
              ? messagesEsAr.social.challengeLabel
              : messagesEsAr.social.tableInviteAction}
            {' · '}
            {invitation.otherNickname}
          </p>
          {invitation.rulesetCode && (
            <Badge variant="neutral">
              {messagesEsAr.social.rulesetLabels[invitation.rulesetCode] ?? invitation.rulesetCode}
            </Badge>
          )}
          <p className="text-[11px] text-muted">
            {messagesEsAr.social.invitationExpires(
              new Date(invitation.expiresAt).toLocaleString('es-AR'),
            )}
          </p>
        </div>
        {direction === 'INCOMING' ? (
          <div className="flex flex-wrap gap-2">
            <CallButton
              tone="accept"
              disabled={busyKey === invitation.id}
              onClick={() => void acceptInvitation(invitation)}
            >
              {messagesEsAr.social.acceptInvitation}
            </CallButton>
            <CallButton
              tone="decline"
              disabled={busyKey === invitation.id}
              onClick={() =>
                void withAction(invitation.id, () => declineSocialInvitationRequest(invitation.id))
              }
            >
              {messagesEsAr.social.declineInvitation}
            </CallButton>
          </div>
        ) : (
          <CallButton
            tone="neutral"
            disabled={busyKey === invitation.id}
            onClick={() =>
              void withAction(invitation.id, () => cancelSocialInvitationRequest(invitation.id))
            }
          >
            {messagesEsAr.social.cancelInvitation}
          </CallButton>
        )}
      </div>
    </li>
  );

  if (loading) {
    return (
      <div
        role="status"
        className="mx-auto max-w-4xl rounded-2xl border border-ivory/15 bg-surface p-8 text-center text-sm text-muted"
      >
        {messagesEsAr.social.loading}
      </div>
    );
  }

  if (loadError) {
    return (
      <section className="mx-auto max-w-xl space-y-4 rounded-2xl border border-danger/40 bg-surface p-6 text-center">
        <h1 className="font-display text-xl font-bold text-ivory">
          {messagesEsAr.social.loadErrorTitle}
        </h1>
        <p role="alert" className="text-sm text-danger-strong">
          {loadError}
        </p>
        <CallButton tone="truco" onClick={() => void loadPanel()}>
          {messagesEsAr.social.retry}
        </CallButton>
      </section>
    );
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5" aria-labelledby="social-heading">
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-gold/35 bg-surface p-5">
        <div>
          <h1 id="social-heading" className="font-display text-2xl font-bold text-ivory">
            {messagesEsAr.social.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{messagesEsAr.social.subtitle}</p>
        </div>
        <Badge
          variant={
            wsStatus === 'connected' ? 'success' : wsStatus === 'offline' ? 'danger' : 'gold'
          }
        >
          {wsStatus === 'connected'
            ? messagesEsAr.social.realtimeConnected
            : wsStatus === 'offline'
              ? messagesEsAr.social.realtimeOffline
              : messagesEsAr.social.realtimeReconnecting}
        </Badge>
      </header>

      {actionError && (
        <p
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger-strong"
        >
          {actionError}
        </p>
      )}
      {toast && (
        <p
          role="status"
          className="rounded-xl border border-green/30 bg-green/10 p-3 text-sm text-green"
        >
          {toast}
        </p>
      )}

      <section className="rounded-2xl border border-ivory/15 bg-surface p-4 tablet:p-5 space-y-4">
        <h2 className="font-display text-lg font-bold text-ivory">
          {messagesEsAr.social.searchHeading}
        </h2>
        <form
          onSubmit={(event) => void handleSearch(event)}
          className="flex flex-col tablet:flex-row gap-2.5"
        >
          <label className="sr-only" htmlFor="social-search">
            {messagesEsAr.social.searchLabel}
          </label>
          <input
            id="social-search"
            value={nicknameQuery}
            onChange={(event) => setNicknameQuery(event.target.value)}
            minLength={2}
            maxLength={32}
            autoComplete="off"
            placeholder={messagesEsAr.social.searchPlaceholder}
            className="min-h-[44px] flex-1 rounded-xl border border-ivory/25 bg-elevated px-3.5 text-sm text-ivory placeholder:text-muted/70"
          />
          <CallButton tone="truco" disabled={searching}>
            {searching ? messagesEsAr.social.searching : messagesEsAr.social.searchAction}
          </CallButton>
        </form>
        {searchResults.length === 0 && nicknameQuery.trim().length >= 2 && !searching ? (
          <p className="text-xs text-muted">{messagesEsAr.social.searchEmpty}</p>
        ) : (
          <ul className="grid grid-cols-1 tablet:grid-cols-2 gap-2.5">
            {searchResults.map((player) => (
              <li
                key={player.userId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ivory/15 bg-elevated p-3"
              >
                <button
                  type="button"
                  onClick={() => onNavigate(`/jugador/${player.userId}`)}
                  className="min-h-[44px] flex items-center gap-2.5 text-left"
                >
                  <Avatar nickname={player.nickname} sizePx={36} />
                  <span>
                    <span className="block text-sm font-semibold text-ivory">
                      {player.nickname}
                    </span>
                    <span className="text-[11px] text-muted">
                      {relationLabel(player.relationship)}
                    </span>
                  </span>
                </button>
                <div className="flex flex-wrap gap-2">
                  {player.relationship === 'NONE' && (
                    <CallButton
                      tone="accept"
                      disabled={busyKey === player.userId}
                      onClick={() =>
                        void withAction(
                          player.userId,
                          () => createFriendRequestRequest({ targetUserId: player.userId }),
                          messagesEsAr.social.friendRequestSent,
                        )
                      }
                    >
                      {messagesEsAr.social.sendRequest}
                    </CallButton>
                  )}
                  {player.relationship === 'PENDING_INCOMING' && (
                    <Badge variant="gold">{messagesEsAr.social.statusPendingIncoming}</Badge>
                  )}
                  {player.relationship === 'PENDING_OUTGOING' && (
                    <Badge variant="neutral">{messagesEsAr.social.statusPendingOutgoing}</Badge>
                  )}
                  <ReportButton
                    targets={[{ userId: player.userId, nickname: player.nickname }]}
                    myUserId={currentUser?.id}
                    label={messagesEsAr.social.reportPlayer}
                  />
                  <CallButton
                    tone="neutral"
                    disabled={busyKey === player.userId}
                    onClick={() =>
                      void withAction(`block:${player.userId}`, () =>
                        blockUserRequest(player.userId),
                      )
                    }
                  >
                    {messagesEsAr.social.blockAction}
                  </CallButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-cols-1 desktop:grid-cols-2 gap-5 items-start">
        <section className="rounded-2xl border border-ivory/15 bg-surface p-4 tablet:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-ivory">
              {messagesEsAr.social.friendsHeading}
            </h2>
            <Badge variant="neutral">{friends.length}</Badge>
          </div>
          {friends.length === 0 ? (
            <p className="rounded-xl bg-elevated p-4 text-sm text-muted">
              {messagesEsAr.social.friendsEmpty}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {friends.map((friend) => (
                <li
                  key={friend.userId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ivory/15 bg-elevated p-3"
                >
                  <button
                    type="button"
                    onClick={() => onNavigate(`/jugador/${friend.userId}`)}
                    className="min-h-[44px] flex items-center gap-2.5 text-left"
                  >
                    <Avatar
                      nickname={friend.nickname}
                      sizePx={38}
                      connected={friend.presence !== null}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ivory">
                        {friend.nickname}
                      </span>
                      <span className="text-[11px] text-muted">
                        {friend.presence === 'IN_GAME'
                          ? messagesEsAr.social.presenceInGame
                          : friend.presence === 'ONLINE'
                            ? messagesEsAr.social.presenceOnline
                            : messagesEsAr.social.presenceHidden}
                      </span>
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <CallButton
                      tone="truco"
                      disabled={busyKey === `challenge:${friend.userId}`}
                      onClick={() =>
                        void withAction(
                          `challenge:${friend.userId}`,
                          () =>
                            createDirectChallengeRequest({
                              recipientUserId: friend.userId,
                              mode: '1v1',
                              rulesetCode,
                            }),
                          messagesEsAr.social.challengeSent,
                        )
                      }
                    >
                      {messagesEsAr.social.challengeAction}
                    </CallButton>
                    <ReportButton
                      targets={[{ userId: friend.userId, nickname: friend.nickname }]}
                      myUserId={currentUser?.id}
                      label={messagesEsAr.social.reportPlayer}
                    />
                    <CallButton
                      tone="neutral"
                      disabled={busyKey === `remove:${friend.userId}`}
                      onClick={() =>
                        void withAction(`remove:${friend.userId}`, () =>
                          removeFriendRequest(friend.userId),
                        )
                      }
                    >
                      {messagesEsAr.social.removeFriend}
                    </CallButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-ivory/15 bg-surface p-4 tablet:p-5 space-y-3">
          <h2 className="font-display text-lg font-bold text-ivory">
            {messagesEsAr.social.requestsHeading}
          </h2>
          {friendRequests.length === 0 ? (
            <p className="rounded-xl bg-elevated p-4 text-sm text-muted">
              {messagesEsAr.social.requestsEmpty}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {friendRequests.map((request) => (
                <li
                  key={request.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ivory/15 bg-elevated p-3"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar nickname={request.nickname} sizePx={36} />
                    <span>
                      <span className="block text-sm font-semibold text-ivory">
                        {request.nickname}
                      </span>
                      <span className="text-[11px] text-muted">
                        {request.direction === 'INCOMING'
                          ? messagesEsAr.social.incomingRequest
                          : messagesEsAr.social.outgoingRequest}
                      </span>
                    </span>
                  </div>
                  {request.direction === 'INCOMING' ? (
                    <div className="flex gap-2">
                      <CallButton
                        tone="accept"
                        disabled={busyKey === request.id}
                        onClick={() =>
                          void withAction(
                            request.id,
                            () => acceptFriendRequestRequest(request.id),
                            messagesEsAr.social.friendRequestAccepted,
                          )
                        }
                      >
                        {messagesEsAr.social.acceptRequest}
                      </CallButton>
                      <CallButton
                        tone="decline"
                        disabled={busyKey === request.id}
                        onClick={() =>
                          void withAction(request.id, () => declineFriendRequestRequest(request.id))
                        }
                      >
                        {messagesEsAr.social.declineRequest}
                      </CallButton>
                    </div>
                  ) : (
                    <CallButton
                      tone="neutral"
                      disabled={busyKey === request.id}
                      onClick={() =>
                        void withAction(request.id, () => cancelFriendRequestRequest(request.id))
                      }
                    >
                      {messagesEsAr.social.cancelRequest}
                    </CallButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-gold/25 bg-surface p-4 tablet:p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ivory">
            {messagesEsAr.social.tableInviteHeading}
          </h2>
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            {messagesEsAr.social.challengeRulesLabel}
            <select
              value={rulesetCode}
              onChange={(event) => setRulesetCode(event.target.value as RulesetCode)}
              className="min-h-[40px] rounded-lg border border-ivory/20 bg-elevated px-2 text-ivory"
            >
              {(
                [
                  'ar-standard-v1',
                  'ar-sin-flor-v1',
                  'ar-corto-15-v1',
                  'ar-corto-15-flor-v1',
                ] as const
              ).map((code) => (
                <option key={code} value={code}>
                  {messagesEsAr.social.rulesetLabels[code]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {incomingInvitations.length === 0 ? (
          <p className="rounded-xl bg-elevated p-4 text-sm text-muted">
            {messagesEsAr.social.tableInviteEmpty}
          </p>
        ) : (
          <ul className="grid grid-cols-1 desktop:grid-cols-2 gap-2.5">
            {incomingInvitations.map((invitation) => renderInvitation(invitation, 'INCOMING'))}
          </ul>
        )}
        {outgoingInvitations.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-ivory">
              {messagesEsAr.social.outgoingRequest}
            </h3>
            <ul className="grid grid-cols-1 desktop:grid-cols-2 gap-2.5">
              {outgoingInvitations.map((invitation) => renderInvitation(invitation, 'OUTGOING'))}
            </ul>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 desktop:grid-cols-2 gap-5 items-start">
        <section className="rounded-2xl border border-ivory/15 bg-surface p-4 tablet:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold text-ivory">
              {messagesEsAr.social.notificationsHeading}
            </h2>
            <div className="flex items-center gap-2">
              <Badge variant={unreadCount > 0 ? 'gold' : 'neutral'}>
                {messagesEsAr.social.unreadCount(unreadCount)}
              </Badge>
              {unreadCount > 0 && (
                <CallButton
                  tone="neutral"
                  onClick={() =>
                    void withAction('read-all', async () => {
                      await markAllSocialNotificationsReadRequest();
                      setNotifications((previous) =>
                        previous.map((item) => ({ ...item, readAt: new Date().toISOString() })),
                      );
                      setUnreadCount(0);
                    })
                  }
                >
                  {messagesEsAr.social.markAllRead}
                </CallButton>
              )}
            </div>
          </div>
          {notifications.length === 0 ? (
            <p className="rounded-xl bg-elevated p-4 text-sm text-muted">
              {messagesEsAr.social.notificationsEmpty}
            </p>
          ) : (
            <ul className="space-y-2">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${notification.readAt ? 'border-ivory/10 bg-elevated/55' : 'border-gold/30 bg-elevated'}`}
                >
                  <p className="text-xs text-ivory">
                    <strong>{notification.actorNickname ?? messagesEsAr.social.title}</strong>{' '}
                    {messagesEsAr.social.notificationTypes[notification.type] ?? notification.type}
                  </p>
                  {!notification.readAt && (
                    <CallButton
                      tone="neutral"
                      onClick={() =>
                        void withAction(notification.id, async () => {
                          await markSocialNotificationReadRequest(notification.id);
                          setNotifications((previous) =>
                            previous.map((item) =>
                              item.id === notification.id
                                ? { ...item, readAt: new Date().toISOString() }
                                : item,
                            ),
                          );
                          setUnreadCount((previous) => Math.max(0, previous - 1));
                        })
                      }
                    >
                      {messagesEsAr.social.markRead}
                    </CallButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-ivory/15 bg-surface p-4 tablet:p-5 space-y-3">
          <h2 className="font-display text-lg font-bold text-ivory">
            {messagesEsAr.social.blockedHeading}
          </h2>
          {blockedUsers.length === 0 ? (
            <p className="rounded-xl bg-elevated p-4 text-sm text-muted">
              {messagesEsAr.social.blockedEmpty}
            </p>
          ) : (
            <ul className="space-y-2">
              {blockedUsers.map((blocked) => (
                <li
                  key={blocked.userId}
                  className="flex items-center justify-between gap-3 rounded-xl border border-ivory/15 bg-elevated p-3"
                >
                  <span className="text-sm font-semibold text-ivory">{blocked.nickname}</span>
                  <CallButton
                    tone="neutral"
                    disabled={busyKey === blocked.userId}
                    onClick={() =>
                      void withAction(`unblock:${blocked.userId}`, () =>
                        unblockUserRequest(blocked.userId),
                      )
                    }
                  >
                    {messagesEsAr.social.unblockAction}
                  </CallButton>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="flex justify-end">
        <CallButton tone="neutral" onClick={() => void loadPanel()}>
          {messagesEsAr.social.retry}
        </CallButton>
      </div>
    </main>
  );
}
