import { ROUTE_UNIT } from './space.ts'

/*
 * The costs that shape routes, gathered so they can be tuned by eye, in plane units of route length. The path search
 * prices every path by them, and the finishing passes take a shortcut only when it is cheaper at the same bend price.
 */

/** A bend costs three cells of length. More gives routes with fewer bends that take longer ways round. */
export const BEND = ROUTE_UNIT * 3
/**
 * Crossing another route costs five bends: a route may cut across others rather than go round a building or a slab to
 * avoid them. Ten bends removed a tenth to a third of the crossings on dense maps but sent routes on long detours round
 * whole slabs (a private service's Component map: 1421 cells against 1311 at five, Backlog.md's 5377 against 4492). More gives fewer
 * crossings and longer detours.
 */
export const CROSSING = BEND * 5
/** Leaving or entering by a wall other than the preferred one; another wall wins only where it saves crossings or length. */
export const OTHER_WALL = BEND / 4
/**
 * Each route a channel holds beyond its comfortable spacing costs this much per unit of the stretch it crowds, and the
 * next one twice as much: a full channel sends routes around other buildings. More spreads routes over more channels.
 */
export const CROWDING = 2
/** A path that fits nowhere else may overfill a channel, at a cost above any detour. A sentinel rather than a dial. */
export const OVERFLOW = BEND * 40
/**
 * A route along a channel stretch that a route sharing its source or target already takes pays this share of the length:
 * routes into one element, or out of one, ride a common trunk as early as they can instead of running side by side.
 */
export const JOINED_LENGTH = 0.8
/**
 * After every route is found, each is searched once more with a crossing priced this many times higher, so a route
 * that crosses others takes another way where that costs little; routes that cross nothing keep their way. Measured at
 * two and four times: two took Backlog.md's Component map from 89 to 73 crossings for 12% more length; four cost 50%
 * more length.
 */
export const UNTANGLE = 2
/**
 * A route across an actors or external island that holds neither of its ends pays this many times the length there,
 * so it goes round another island's buildings instead of threading between them.
 */
export const FOREIGN_LENGTH = 1.5
