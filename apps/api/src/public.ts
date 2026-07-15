import { BadRequestException, Body, Controller, Get, Injectable, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AccessTokenGuard, CurrentUser, type AccessPrincipal } from "./auth.guard.js";
import { DatabaseService } from "./database.service.js";

@Injectable()
export class PublicService {
  constructor(private readonly database: DatabaseService) {}
  async market() {
    const [regime,sectors,summary,movers]=await Promise.all([
      this.database.pool.query("SELECT regime,strength,breadth_bps,average_return_bps,started_at FROM market_regimes WHERE ended_at IS NULL LIMIT 1"),
      this.database.pool.query("SELECT sec.id,sec.slug,sec.name,COALESCE(ss.strength,0) strength,COALESCE(ss.average_return_bps,0) average_return_bps FROM sectors sec LEFT JOIN sector_states ss ON ss.sector_id=sec.id ORDER BY strength DESC,sec.name"),
      this.database.pool.query("SELECT count(*)::int stock_count,sum(current_price*total_shares)::bigint market_cap,avg((current_price-previous_close)*10000/previous_close)::int average_return_bps FROM stocks WHERE listing_status<>'delisted'"),
      this.database.pool.query("SELECT symbol,current_price,previous_close,((current_price-previous_close)*10000/previous_close)::int change_bps FROM stocks WHERE listing_status='normal' ORDER BY abs((current_price-previous_close)*10000/previous_close) DESC LIMIT 10"),
    ]); return { regime:regime.rows[0]??null,sectors:sectors.rows,summary:summary.rows[0],movers:movers.rows };
  }
  async news(){return(await this.database.pool.query("SELECT ce.id,ce.event_type,ce.title,ce.description,ce.starts_at,ce.ends_at,c.id company_id,c.name company_name,s.symbol FROM corporate_events ce JOIN companies c ON c.id=ce.company_id LEFT JOIN stocks s ON s.company_id=c.id ORDER BY ce.starts_at DESC LIMIT 200")).rows;}
  async leaderboard(){const cycle=await this.database.pool.query<{id:string;completed_at:Date}>("SELECT id,completed_at FROM valuation_cycles WHERE status='completed' ORDER BY completed_at DESC LIMIT 1");if(!cycle.rows[0])return{cycle:null,items:[]};const items=await this.database.pool.query("SELECT row_number() OVER(ORDER BY uv.total_asset_value DESC) rank,u.id,u.nickname,u.username,uv.total_asset_value,uv.eligible_asset_value FROM user_valuation_snapshots uv JOIN users u ON u.id=uv.user_id WHERE uv.cycle_id=$1 ORDER BY uv.total_asset_value DESC LIMIT 100",[cycle.rows[0].id]);return{cycle:cycle.rows[0],items:items.rows};}
  async profile(userId:string){const [user,stats,snapshot]=await Promise.all([this.database.pool.query("SELECT id,email,username,nickname,role,created_at FROM users WHERE id=$1",[userId]),this.database.pool.query(`SELECT (SELECT count(*) FROM trades WHERE buyer_user_id=$1 OR seller_user_id=$1)::int trades,(SELECT count(*) FROM strategies WHERE user_id=$1)::int strategies,(SELECT count(*) FROM mna_campaigns WHERE attacker_user_id=$1)::int mna_campaigns`,[userId]),this.database.pool.query("SELECT uv.* FROM user_valuation_snapshots uv JOIN valuation_cycles vc ON vc.id=uv.cycle_id WHERE uv.user_id=$1 AND vc.status='completed' ORDER BY vc.completed_at DESC LIMIT 1",[userId])]);return{user:user.rows[0],stats:stats.rows[0],valuation:snapshot.rows[0]??null};}
  async settings(userId:string){const r=await this.database.pool.query("INSERT INTO user_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO UPDATE SET user_id=EXCLUDED.user_id RETURNING *",[userId]);return r.rows[0];}
  async updateSettings(userId:string,input:unknown){const schema=z.object({priceColorMode:z.enum(["korean","global"]),locale:z.enum(["ko-KR","en-US"])}).partial().strict();const r=schema.safeParse(input);if(!r.success)throw new BadRequestException(r.error.issues);return(await this.database.pool.query("INSERT INTO user_preferences(user_id,price_color_mode,locale) VALUES($1,COALESCE($2,'korean'),COALESCE($3,'ko-KR')) ON CONFLICT(user_id) DO UPDATE SET price_color_mode=COALESCE($2,user_preferences.price_color_mode),locale=COALESCE($3,user_preferences.locale),updated_at=now() RETURNING *",[userId,r.data.priceColorMode??null,r.data.locale??null])).rows[0];}
  async notifications(userId:string){return(await this.database.pool.query("SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200",[userId])).rows;}
  async readNotifications(userId:string){await this.database.pool.query("UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",[userId]);return{success:true};}
}

@Controller("market") export class MarketOverviewController{constructor(private readonly service:PublicService){}@Get() get(){return this.service.market();}}
@Controller("news") export class NewsController{constructor(private readonly service:PublicService){}@Get() get(){return this.service.news();}}
@Controller("leaderboard") export class LeaderboardController{constructor(private readonly service:PublicService){}@Get() get(){return this.service.leaderboard();}}
@Controller("profile") @UseGuards(AccessTokenGuard) export class ProfileController{constructor(private readonly service:PublicService){}@Get() get(@CurrentUser()u:AccessPrincipal){return this.service.profile(u.userId);}}
@Controller("settings") @UseGuards(AccessTokenGuard) export class SettingsController{constructor(private readonly service:PublicService){}@Get() get(@CurrentUser()u:AccessPrincipal){return this.service.settings(u.userId)}@Patch() patch(@CurrentUser()u:AccessPrincipal,@Body()b:unknown){return this.service.updateSettings(u.userId,b)}}
@Controller("notifications") @UseGuards(AccessTokenGuard) export class NotificationController{constructor(private readonly service:PublicService){}@Get() get(@CurrentUser()u:AccessPrincipal){return this.service.notifications(u.userId)}@Post("read") read(@CurrentUser()u:AccessPrincipal){return this.service.readNotifications(u.userId)}}
