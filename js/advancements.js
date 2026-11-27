const ADV_CATS = {"story":{"title":"Minecraft","icon":"grass_block"},"nether":{"title":"下界","icon":"red_nether_bricks"},"end":{"title":"末地","icon":"end_stone"},"adventure":{"title":"冒险","icon":"map"},"husbandry":{"title":"农牧业","icon":"hay_block"}};
const ADVANCEMENTS = {
  "story/root": {"cat":"story","title":"Minecraft","desc":"游戏的核心与故事","icon":"grass_block","frame":"task","parent":"","hidden":false},
  "story/mine_stone": {"cat":"story","title":"石器时代","desc":"用你的新镐挖掘石头","icon":"wooden_pickaxe","frame":"task","parent":"story/root","hidden":false},
  "story/upgrade_tools": {"cat":"story","title":"获得升级","desc":"制作一把更好的镐","icon":"stone_pickaxe","frame":"task","parent":"story/mine_stone","hidden":false},
  "story/smelt_iron": {"cat":"story","title":"来硬的","desc":"冶炼出一块铁锭","icon":"iron_ingot","frame":"task","parent":"story/upgrade_tools","hidden":false},
  "story/obtain_armor": {"cat":"story","title":"整装上阵","desc":"用铁盔甲来保护你自己","icon":"iron_chestplate","frame":"task","parent":"story/smelt_iron","hidden":false},
  "story/deflect_arrow": {"cat":"story","title":"不吃这套，谢谢","desc":"用盾牌反弹一个弹射物","icon":"shield","frame":"task","parent":"story/obtain_armor","hidden":false},
  "story/lava_bucket": {"cat":"story","title":"热腾腾的","desc":"用铁桶装点熔岩","icon":"lava_bucket","frame":"task","parent":"story/smelt_iron","hidden":false},
  "story/form_obsidian": {"cat":"story","title":"冰桶挑战","desc":"获得一块黑曜石","icon":"obsidian","frame":"task","parent":"story/lava_bucket","hidden":false},
  "story/enter_the_nether": {"cat":"story","title":"勇往直下","desc":"建造、激活并进入一座下界传送门","icon":"flint_and_steel","frame":"task","parent":"story/form_obsidian","hidden":false},
  "story/cure_zombie_villager": {"cat":"story","title":"僵尸科医生","desc":"弱化并治疗一名僵尸村民","icon":"golden_apple","frame":"goal","parent":"story/enter_the_nether","hidden":false},
  "story/follow_ender_eye": {"cat":"story","title":"隔墙有眼","desc":"跟随末影之眼","icon":"ender_eye","frame":"task","parent":"story/enter_the_nether","hidden":false},
  "story/enter_the_end": {"cat":"story","title":"结束了？","desc":"进入末地传送门","icon":"end_stone","frame":"task","parent":"story/follow_ender_eye","hidden":false},
  "story/iron_tools": {"cat":"story","title":"这不是铁镐么？","desc":"升级你的镐","icon":"iron_pickaxe","frame":"task","parent":"story/smelt_iron","hidden":false},
  "story/mine_diamond": {"cat":"story","title":"钻石！","desc":"获得钻石","icon":"diamond","frame":"task","parent":"story/iron_tools","hidden":false},
  "story/shiny_gear": {"cat":"story","title":"钻石护体","desc":"钻石盔甲能救人","icon":"diamond_chestplate","frame":"task","parent":"story/mine_diamond","hidden":false},
  "story/enchant_item": {"cat":"story","title":"附魔师","desc":"用附魔台附魔一样物品","icon":"enchanted_book","frame":"task","parent":"story/mine_diamond","hidden":false},
  "nether/root": {"cat":"nether","title":"下界","desc":"记得带夏装","icon":"red_nether_bricks","frame":"task","parent":"","hidden":false},
  "nether/find_bastion": {"cat":"nether","title":"光辉岁月","desc":"进入堡垒遗迹","icon":"polished_blackstone_bricks","frame":"task","parent":"nether/root","hidden":false},
  "nether/loot_bastion": {"cat":"nether","title":"战猪","desc":"掠夺堡垒遗迹里的箱子","icon":"chest","frame":"task","parent":"nether/find_bastion","hidden":false},
  "nether/fast_travel": {"cat":"nether","title":"曲速泡","desc":"利用下界移动对应主世界7千米的距离","icon":"map","frame":"challenge","parent":"nether/root","hidden":false},
  "nether/obtain_ancient_debris": {"cat":"nether","title":"深藏不露","desc":"获得远古残骸","icon":"ancient_debris","frame":"task","parent":"nether/root","hidden":false},
  "nether/netherite_armor": {"cat":"nether","title":"残骸裹身","desc":"获得一整套下界合金盔甲","icon":"netherite_chestplate","frame":"challenge","parent":"nether/obtain_ancient_debris","hidden":false},
  "nether/ride_strider": {"cat":"nether","title":"画船添足","desc":"手持诡异菌钓竿骑乘炽足兽","icon":"warped_fungus_on_a_stick","frame":"task","parent":"nether/root","hidden":false},
  "nether/ride_strider_in_overworld_lava": {"cat":"nether","title":"温暖如家","desc":"带炽足兽在主世界的熔岩湖上来一场长——途旅行","icon":"warped_fungus_on_a_stick","frame":"task","parent":"nether/ride_strider","hidden":false},
  "nether/explore_nether": {"cat":"nether","title":"热门景点","desc":"探索所有下界生物群系","icon":"netherite_boots","frame":"challenge","parent":"nether/ride_strider","hidden":false},
  "nether/return_to_sender": {"cat":"nether","title":"见鬼去吧","desc":"用一团火球干掉一只恶魂","icon":"fire_charge","frame":"challenge","parent":"nether/root","hidden":false},
  "nether/uneasy_alliance": {"cat":"nether","title":"脆弱的同盟","desc":"从下界救出一只恶魂，将其安全地带到主世界……然后干掉它","icon":"ghast_tear","frame":"challenge","parent":"nether/return_to_sender","hidden":false},
  "nether/obtain_crying_obsidian": {"cat":"nether","title":"谁在切洋葱？","desc":"获得哭泣的黑曜石","icon":"crying_obsidian","frame":"task","parent":"nether/root","hidden":false},
  "nether/charge_respawn_anchor": {"cat":"nether","title":"锚没有九条命","desc":"为重生锚充满能量","icon":"respawn_anchor","frame":"task","parent":"nether/obtain_crying_obsidian","hidden":false},
  "nether/distract_piglin": {"cat":"nether","title":"金光闪闪！","desc":"用金质物品让猪灵分神","icon":"gold_ingot","frame":"task","parent":"nether/root","hidden":false},
  "nether/find_fortress": {"cat":"nether","title":"阴森的要塞","desc":"闯入下界要塞","icon":"nether_bricks","frame":"task","parent":"nether/root","hidden":false},
  "nether/obtain_blaze_rod": {"cat":"nether","title":"与火共舞","desc":"让烈焰人从烈焰棒中解放吧","icon":"blaze_rod","frame":"task","parent":"nether/find_fortress","hidden":false},
  "nether/brew_potion": {"cat":"nether","title":"本地酿造厂","desc":"酿造一瓶药水","icon":"potion","frame":"task","parent":"nether/obtain_blaze_rod","hidden":false},
  "nether/all_potions": {"cat":"nether","title":"狂乱的鸡尾酒","desc":"同时拥有所有药水效果","icon":"milk_bucket","frame":"challenge","parent":"nether/brew_potion","hidden":false},
  "nether/all_effects": {"cat":"nether","title":"为什么会变成这样呢？","desc":"同时拥有所有状态效果","icon":"bucket","frame":"challenge","parent":"nether/all_potions","hidden":true},
  "nether/get_wither_skull": {"cat":"nether","title":"惊悚恐怖骷髅头","desc":"获得凋灵骷髅的头颅","icon":"wither_skeleton_skull","frame":"task","parent":"nether/find_fortress","hidden":false},
  "nether/summon_wither": {"cat":"nether","title":"凋零山庄","desc":"召唤凋灵","icon":"nether_star","frame":"task","parent":"nether/get_wither_skull","hidden":false},
  "nether/create_beacon": {"cat":"nether","title":"带信标回家","desc":"建造并放置一个信标","icon":"beacon","frame":"task","parent":"nether/summon_wither","hidden":false},
  "nether/create_full_beacon": {"cat":"nether","title":"信标工程师","desc":"让一座信标发挥最大功效","icon":"beacon","frame":"goal","parent":"nether/create_beacon","hidden":false},
  "end/root": {"cat":"end","title":"末地","desc":"抑或是起点？","icon":"end_stone","frame":"task","parent":"","hidden":false},
  "end/kill_dragon": {"cat":"end","title":"解放末地","desc":"祝君好运","icon":"dragon_head","frame":"task","parent":"end/root","hidden":false},
  "end/dragon_egg": {"cat":"end","title":"下一世代","desc":"获得龙蛋","icon":"dragon_egg","frame":"goal","parent":"end/kill_dragon","hidden":false},
  "end/dragon_breath": {"cat":"end","title":"你需要来点薄荷糖","desc":"用玻璃瓶收集一些龙息","icon":"dragon_breath","frame":"goal","parent":"end/kill_dragon","hidden":false},
  "end/respawn_dragon": {"cat":"end","title":"结束了…再一次…","desc":"复活末影龙","icon":"end_crystal","frame":"goal","parent":"end/kill_dragon","hidden":false},
  "end/enter_end_gateway": {"cat":"end","title":"远程折跃","desc":"逃离这座岛屿","icon":"ender_pearl","frame":"task","parent":"end/kill_dragon","hidden":false},
  "end/find_end_city": {"cat":"end","title":"在游戏尽头的城市","desc":"进去吧，又能发生什么呢？","icon":"purpur_block","frame":"task","parent":"end/enter_end_gateway","hidden":false},
  "end/elytra": {"cat":"end","title":"天空即为极限","desc":"找到鞘翅","icon":"elytra","frame":"goal","parent":"end/find_end_city","hidden":false},
  "end/levitate": {"cat":"end","title":"这上面的风景不错","desc":"利用潜影贝的攻击向上飘浮50个方块","icon":"shulker_shell","frame":"challenge","parent":"end/find_end_city","hidden":false},
  "adventure/root": {"cat":"adventure","title":"冒险","desc":"冒险、探索与战斗","icon":"map","frame":"task","parent":"","hidden":false},
  "adventure/use_lodestone": {"cat":"adventure","title":"天涯共此石","desc":"对着磁石使用指南针","icon":"lodestone","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/heart_transplanter": {"cat":"adventure","title":"移心接木","desc":"将嘎枝之心以正确朝向放在两个苍白橡木原木方块中间","icon":"creaking_heart","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/minecraft_trials_edition": {"cat":"adventure","title":"Minecraft：试炼版","desc":"踏入试炼密室","icon":"chiseled_tuff","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/overoverkill": {"cat":"adventure","title":"天赐良击","desc":"使用重锤一击造成50颗心的伤害","icon":"mace","frame":"challenge","parent":"adventure/minecraft_trials_edition","hidden":false},
  "adventure/under_lock_and_key": {"cat":"adventure","title":"珍藏密敛","desc":"用试炼钥匙解锁宝库","icon":"trial_key","frame":"task","parent":"adventure/minecraft_trials_edition","hidden":false},
  "adventure/revaulting": {"cat":"adventure","title":"宝经磨炼","desc":"用不祥试炼钥匙解锁不祥宝库","icon":"ominous_trial_key","frame":"goal","parent":"adventure/under_lock_and_key","hidden":false},
  "adventure/who_needs_rockets": {"cat":"adventure","title":"还要啥火箭啊？","desc":"使用风弹将自己向上弹射8格","icon":"wind_charge","frame":"task","parent":"adventure/minecraft_trials_edition","hidden":false},
  "adventure/blowback": {"cat":"adventure","title":"逆风翻盘","desc":"反弹旋风人的风弹来击杀旋风人","icon":"wind_charge","frame":"challenge","parent":"adventure/minecraft_trials_edition","hidden":false},
  "adventure/lighten_up": {"cat":"adventure","title":"铜光焕发","desc":"用斧刮削铜灯来让它变得更亮","icon":"copper_bulb","frame":"task","parent":"adventure/minecraft_trials_edition","hidden":false},
  "adventure/fall_from_world_height": {"cat":"adventure","title":"上天入地","desc":"从世界顶部（建筑高度限制处）自由落体，坠至世界底部并存活下来","icon":"water_bucket","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/crafters_crafting_crafters": {"cat":"adventure","title":"合成器合成合成器","desc":"靠近一个正在合成合成器的合成器","icon":"crafter","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/kill_a_mob": {"cat":"adventure","title":"怪物猎人","desc":"杀死任意敌对性怪物","icon":"iron_sword","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/spear_many_mobs": {"cat":"adventure","title":"生物串串香","desc":"用矛在一次冲锋攻击内命中五只生物","icon":"iron_spear","frame":"goal","parent":"adventure/kill_a_mob","hidden":false},
  "adventure/kill_mob_near_sculk_catalyst": {"cat":"adventure","title":"它蔓延了","desc":"在幽匿催发体附近杀死生物","icon":"sculk_catalyst","frame":"challenge","parent":"adventure/kill_a_mob","hidden":false},
  "adventure/throw_trident": {"cat":"adventure","title":"抖包袱","desc":"往什么东西扔出三叉戟。\n注：别把你唯一的武器也抖掉了。","icon":"trident","frame":"task","parent":"adventure/kill_a_mob","hidden":false},
  "adventure/very_very_frightening": {"cat":"adventure","title":"魔女审判","desc":"雷击一名村民","icon":"trident","frame":"task","parent":"adventure/throw_trident","hidden":false},
  "adventure/shoot_arrow": {"cat":"adventure","title":"瞄准目标","desc":"用弓箭射点什么","icon":"bow","frame":"task","parent":"adventure/kill_a_mob","hidden":false},
  "adventure/bullseye": {"cat":"adventure","title":"正中靶心","desc":"从至少30米外射中标靶的靶心","icon":"target","frame":"challenge","parent":"adventure/shoot_arrow","hidden":false},
  "adventure/sniper_duel": {"cat":"adventure","title":"狙击手的对决","desc":"从至少50米外射杀一只骷髅","icon":"arrow","frame":"challenge","parent":"adventure/shoot_arrow","hidden":false},
  "adventure/kill_all_mobs": {"cat":"adventure","title":"资深怪物猎人","desc":"杀死每一种敌对性怪物","icon":"diamond_sword","frame":"challenge","parent":"adventure/kill_a_mob","hidden":false},
  "adventure/totem_of_undying": {"cat":"adventure","title":"超越生死","desc":"利用不死图腾逃离死神","icon":"totem_of_undying","frame":"goal","parent":"adventure/kill_a_mob","hidden":false},
  "adventure/trade": {"cat":"adventure","title":"成交！","desc":"成功与一名村民进行交易","icon":"emerald","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/summon_iron_golem": {"cat":"adventure","title":"招募援兵","desc":"召唤一只铁傀儡来帮忙守卫村庄","icon":"carved_pumpkin","frame":"goal","parent":"adventure/trade","hidden":false},
  "adventure/trade_at_world_height": {"cat":"adventure","title":"星际商人","desc":"在建筑高度限制处与村民交易","icon":"emerald","frame":"task","parent":"adventure/trade","hidden":false},
  "adventure/ol_betsy": {"cat":"adventure","title":"扣下悬刀","desc":"用弩进行一次射击","icon":"crossbow","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/two_birds_one_arrow": {"cat":"adventure","title":"一箭双雕","desc":"用一支穿透箭射杀两只幻翼","icon":"crossbow","frame":"challenge","parent":"adventure/ol_betsy","hidden":false},
  "adventure/arbalistic": {"cat":"adventure","title":"劲弩手","desc":"用弩一发击杀五种生物","icon":"crossbow","frame":"challenge","parent":"adventure/ol_betsy","hidden":true},
  "adventure/whos_the_pillager_now": {"cat":"adventure","title":"现在谁才是掠夺者？","desc":"让掠夺者也尝尝弩的滋味","icon":"crossbow","frame":"task","parent":"adventure/ol_betsy","hidden":false},
  "adventure/salvage_sherd": {"cat":"adventure","title":"探古寻源","desc":"刷扫可疑的方块来获得陶片","icon":"brush","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/craft_decorated_pot_using_only_sherds": {"cat":"adventure","title":"精修细补","desc":"用4个陶片制作饰纹陶罐","icon":"decorated_pot","frame":"task","parent":"adventure/salvage_sherd","hidden":false},
  "adventure/trim_with_any_armor_pattern": {"cat":"adventure","title":"旧貌锻新颜","desc":"在锻造台中合成带有纹饰的盔甲","icon":"dune_armor_trim_smithing_template","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/trim_with_all_exclusive_armor_patterns": {"cat":"adventure","title":"匠心独具","desc":"将下列锻造模板都至少使用一次：尖塔、猪鼻、肋骨、监守、幽静、恼鬼、潮汐、向导","icon":"silence_armor_trim_smithing_template","frame":"challenge","parent":"adventure/trim_with_any_armor_pattern","hidden":false},
  "adventure/avoid_vibration": {"cat":"adventure","title":"潜行100级","desc":"在幽匿感测体或监守者周围潜行以防被它们探测到","icon":"sculk_sensor","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/sleep_in_bed": {"cat":"adventure","title":"甜蜜的梦","desc":"在床上睡觉以改变你的重生点","icon":"red_bed","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/adventuring_time": {"cat":"adventure","title":"探索的时光","desc":"发现所有的生物群系","icon":"diamond_boots","frame":"challenge","parent":"adventure/sleep_in_bed","hidden":false},
  "adventure/walk_on_powder_snow_with_leather_boots": {"cat":"adventure","title":"轻功雪上飘","desc":"在细雪上行走……并且不陷进去","icon":"leather_boots","frame":"task","parent":"adventure/sleep_in_bed","hidden":false},
  "adventure/play_jukebox_in_meadows": {"cat":"adventure","title":"音乐之声","desc":"用唱片机的音乐声为草甸增添生机","icon":"jukebox","frame":"task","parent":"adventure/sleep_in_bed","hidden":false},
  "adventure/lightning_rod_with_villager_no_fire": {"cat":"adventure","title":"电涌保护器","desc":"在不引发火灾的前提下保护村民免受雷击","icon":"lightning_rod","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/read_power_of_chiseled_bookshelf": {"cat":"adventure","title":"知识就是力量","desc":"使用红石比较器获取雕纹书架的信号强度","icon":"chiseled_bookshelf","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/honey_block_slide": {"cat":"adventure","title":"胶着状态","desc":"跳入蜂蜜块以缓冲摔落","icon":"honey_block","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/voluntary_exile": {"cat":"adventure","title":"自我放逐","desc":"杀死一名袭击队长。\n或许该考虑暂时远离村庄……","icon":"white_banner","frame":"task","parent":"adventure/root","hidden":true},
  "adventure/hero_of_the_village": {"cat":"adventure","title":"村庄英雄","desc":"成功在袭击中保卫村庄","icon":"white_banner","frame":"challenge","parent":"adventure/voluntary_exile","hidden":true},
  "adventure/brush_armadillo": {"cat":"adventure","title":"这不是鳞甲么？","desc":"用刷子从犰狳身上获得犰狳鳞甲","icon":"armadillo_scute","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/spyglass_at_parrot": {"cat":"adventure","title":"那是鸟吗？","desc":"透过望远镜观察鹦鹉","icon":"spyglass","frame":"task","parent":"adventure/root","hidden":false},
  "adventure/spyglass_at_ghast": {"cat":"adventure","title":"那是气球吗？","desc":"透过望远镜观察恶魂","icon":"spyglass","frame":"task","parent":"adventure/spyglass_at_parrot","hidden":false},
  "adventure/spyglass_at_dragon": {"cat":"adventure","title":"那是飞机吗？","desc":"透过望远镜观察末影龙","icon":"spyglass","frame":"task","parent":"adventure/spyglass_at_ghast","hidden":false},
  "husbandry/root": {"cat":"husbandry","title":"农牧业","desc":"这个世界充满朋友与美食","icon":"hay_block","frame":"task","parent":"","hidden":false},
  "husbandry/place_dried_ghast_in_water": {"cat":"husbandry","title":"补水保湿！","desc":"将失水恶魂方块放在水中","icon":"dried_ghast","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/uh_oh": {"cat":"husbandry","title":"坏了","desc":"让硫方怪吸收TNT方块","icon":"tnt","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/safely_harvest_honey": {"cat":"husbandry","title":"与蜂共舞","desc":"利用营火，在不惊动蜜蜂的情况下，用玻璃瓶从蜂巢收集蜂蜜","icon":"honey_bottle","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/wax_on": {"cat":"husbandry","title":"涂蜡","desc":"将蜜脾涂到铜质方块上！","icon":"honeycomb","frame":"task","parent":"husbandry/safely_harvest_honey","hidden":false},
  "husbandry/wax_off": {"cat":"husbandry","title":"脱蜡","desc":"给铜质方块脱蜡！","icon":"stone_axe","frame":"task","parent":"husbandry/wax_on","hidden":false},
  "husbandry/silk_touch_nest": {"cat":"husbandry","title":"举巢搬迁","desc":"用精准采集移动住着3只蜜蜂的蜂巢或蜂箱","icon":"bee_nest","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/plant_seed": {"cat":"husbandry","title":"开荒垦地","desc":"种下种子，见证它的成长","icon":"wheat","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/balanced_diet": {"cat":"husbandry","title":"均衡饮食","desc":"尝遍天下食材，即便是对身体不好的","icon":"apple","frame":"challenge","parent":"husbandry/plant_seed","hidden":false},
  "husbandry/obtain_netherite_hoe": {"cat":"husbandry","title":"终极奉献","desc":"用下界合金锭升级一把锄，然后重新考虑你的人生抉择","icon":"netherite_hoe","frame":"challenge","parent":"husbandry/plant_seed","hidden":false},
  "husbandry/obtain_sniffer_egg": {"cat":"husbandry","title":"怪味蛋","desc":"获得嗅探兽蛋","icon":"sniffer_egg","frame":"task","parent":"husbandry/root","hidden":true},
  "husbandry/feed_snifflet": {"cat":"husbandry","title":"小小嗅探兽","desc":"喂食一只小嗅探兽","icon":"torchflower_seeds","frame":"task","parent":"husbandry/obtain_sniffer_egg","hidden":true},
  "husbandry/plant_any_sniffer_seed": {"cat":"husbandry","title":"播种往事","desc":"种植任意嗅探兽种子","icon":"pitcher_pod","frame":"task","parent":"husbandry/feed_snifflet","hidden":true},
  "husbandry/breed_an_animal": {"cat":"husbandry","title":"我从哪儿来？","desc":"繁殖一对动物","icon":"wheat","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/bred_all_animals": {"cat":"husbandry","title":"成双成对","desc":"繁殖每种动物！","icon":"golden_carrot","frame":"challenge","parent":"husbandry/breed_an_animal","hidden":false},
  "husbandry/allay_deliver_item_to_player": {"cat":"husbandry","title":"找到一个好朋友","desc":"让悦灵向你投掷物品","icon":"cookie","frame":"task","parent":"husbandry/root","hidden":true},
  "husbandry/allay_deliver_cake_to_note_block": {"cat":"husbandry","title":"生日快乐歌","desc":"让悦灵向音符盒投掷一块蛋糕","icon":"note_block","frame":"task","parent":"husbandry/allay_deliver_item_to_player","hidden":true},
  "husbandry/tame_an_animal": {"cat":"husbandry","title":"永恒的伙伴","desc":"驯服一只动物","icon":"lead","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/remove_wolf_armor": {"cat":"husbandry","title":"华丽一剪","desc":"用剪刀移除狼身上的狼铠","icon":"shears","frame":"task","parent":"husbandry/tame_an_animal","hidden":false},
  "husbandry/repair_wolf_armor": {"cat":"husbandry","title":"完好如初","desc":"用犰狳鳞甲修复损坏的狼铠","icon":"wolf_armor","frame":"task","parent":"husbandry/tame_an_animal","hidden":false},
  "husbandry/complete_catalogue": {"cat":"husbandry","title":"百猫全书","desc":"驯服所有种类的猫！","icon":"cod","frame":"challenge","parent":"husbandry/tame_an_animal","hidden":false},
  "husbandry/whole_pack": {"cat":"husbandry","title":"群狼聚首","desc":"驯服所有种类的狼","icon":"bone","frame":"challenge","parent":"husbandry/tame_an_animal","hidden":false},
  "husbandry/make_a_sign_glow": {"cat":"husbandry","title":"眼前一亮！","desc":"让任意种类告示牌上的文本发光","icon":"glow_ink_sac","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/ride_a_boat_with_a_goat": {"cat":"husbandry","title":"羊帆起航！","desc":"与山羊同船共渡","icon":"oak_boat","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/fishy_business": {"cat":"husbandry","title":"腥味十足的生意","desc":"钓到一条鱼","icon":"fishing_rod","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/tactical_fishing": {"cat":"husbandry","title":"战术性钓鱼","desc":"不用钓鱼竿抓住一条鱼！","icon":"pufferfish_bucket","frame":"task","parent":"husbandry/fishy_business","hidden":false},
  "husbandry/axolotl_in_a_bucket": {"cat":"husbandry","title":"最萌捕食者","desc":"用铁桶捕获一只美西螈","icon":"axolotl_bucket","frame":"task","parent":"husbandry/tactical_fishing","hidden":false},
  "husbandry/kill_axolotl_target": {"cat":"husbandry","title":"友谊的治愈力！","desc":"与美西螈并肩作战并赢得胜利","icon":"tropical_fish_bucket","frame":"task","parent":"husbandry/axolotl_in_a_bucket","hidden":false},
  "husbandry/tadpole_in_a_bucket": {"cat":"husbandry","title":"蚪到桶里来","desc":"用铁桶捕获一只蝌蚪","icon":"tadpole_bucket","frame":"task","parent":"husbandry/root","hidden":false},
  "husbandry/leash_all_frog_variants": {"cat":"husbandry","title":"呱呱队出动","desc":"用拴绳拴住所有种类的青蛙","icon":"lead","frame":"task","parent":"husbandry/tadpole_in_a_bucket","hidden":false},
  "husbandry/froglights": {"cat":"husbandry","title":"相映生辉！","desc":"在你的物品栏中集齐所有种类的蛙明灯","icon":"verdant_froglight","frame":"challenge","parent":"husbandry/leash_all_frog_variants","hidden":false},
};

// ---- 旧存档的成就键位：只做兼容，不参与新版界面显示 ----
const ADV_ALIASES = {
  wood: 'story/root',
  crafting_table: 'story/root',
  pickaxe: 'story/mine_stone',
  stone_pickaxe: 'story/upgrade_tools',
  furnace: 'story/smelt_iron',
  iron: 'story/smelt_iron',
  diamond: 'story/mine_diamond',
  kill: 'adventure/kill_a_mob',
  armor: 'story/obtain_armor',
  farm: 'husbandry/plant_seed',
  bow: 'adventure/shoot_arrow',
  sleep: 'adventure/sleep_in_bed',
  nether: 'nether/root',
  fortress: 'nether/find_fortress',
  blaze_rod: 'nether/obtain_blaze_rod',
  return_sender: 'nether/return_to_sender',
  eye_spy: 'story/follow_ender_eye',
  the_end: 'story/enter_the_end',
  free_end: 'end/kill_dragon',
  next_gen: 'end/dragon_egg',
  enchant_item: 'story/enchant_item',
  'nether/use_lodestone': 'adventure/use_lodestone'
};
const advCanonical = (k) => ADV_ALIASES[k] || k;
function advHasKey(g, key) {
  if (typeof ITEM_KEY === 'undefined') return false;
  const id = ITEM_KEY[key];
  if (id === undefined || !g || !g.player) return false;
  let n = 0;
  for (const s of g.player.inv.slots) if (s && s.id === id) n += s.count;
  return n > 0;
}
function advHasAny(g, keys) { return keys.some((k) => advHasKey(g, k)); }
function advHasAll(g, keys) { return keys.every((k) => advHasKey(g, k)); }
function advStat(g) {
  if (!g.advStat) g.advStat = emptyAdvStat();
  return g.advStat;
}
function emptyAdvStat() {
  return {
    kill: {}, tame: {}, breed: {}, eat: {}, craft: {}, place: {}, pick: {}, smelt: {},
    effects: {}, biomes: {}, cat: {}, wolf: {}, frog: {},
    killHostile: {}, traded: {}, fished: {}, planted: {}, netherBiomes: {},
    trade: 0, fish: 0, fishBucket: 0, sleep: 0, enchant: 0, brew: 0, totem: 0,
    deflect: 0, returnSender: 0, bastion: 0, fortress: 0, lootBastion: 0, wither: 0,
    witherSkull: 0, ancientDebris: 0, cryingObsidian: 0, strider: 0, striderOverworld: 0,
    netherTravel: 0, beacon: 0, beaconLevel: 0, distract: 0, uneasy: 0, lodestone: 0,
    dragon: 0, dragonEgg: 0, gateway: 0, endCity: 0, levitate: 0, respawnDragon: 0,
    adventure: 0, arrow: 0, sniper: 0, crossbow: 0, arbalistic: 0, twoBirds: 0,
    pillager: 0, bullseye: 0, tradeHigh: 0, exile: 0, raid: 0, golem: 0,
    trident: 0, tridentVillager: 0, lighten: 0, lightningSafe: 0, honeySlide: 0,
    snowBoots: 0, jukebox: 0, bookshelf: 0, spyParrot: 0, spyGhast: 0, spyDragon: 0,
    trial: 0, vault: 0, ominousVault: 0, windRockets: 0, crafter: 0, overkill: 0,
    brush: 0, sherd: 0, pot: 0, trim: 0, trimAll: 0, fall: 0, vibration: 0, blowback: 0,
    sculkKill: 0, sniffer: 0, snifferSeed: 0, honey: 0, waxOn: 0, waxOff: 0,
    silkNest: 0, glowSign: 0, boatGoat: 0, allayItem: 0, allayCake: 0, axolotl: 0, plant: 0, chargeAnchor: 0, sculkKill: 0,
    wolfArmorOff: 0, wolfArmorRepair: 0, stronghold: 0, cured: 0,
    heartTransplant: 0, spearMany: 0, driedGhast: 0, uhOh: 0
  };
}
function advBump(g, bucket, key, n = 1) {
  const s = advStat(g), b = s[bucket];
  if (!b) return;
  b[key] = (b[key] || 0) + n;
}
function advFlag(g, key, n = 1) {
  const s = advStat(g);
  s[key] = (s[key] || 0) + n;
}
// 原版工具/装备组
const ADV_IRON_ARMOR = ['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots'];
const ADV_DIAMOND_ARMOR = ['diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots'];
const ADV_NETHERITE_ARMOR = ['netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots'];
const ADV_FROGLIGHTS = ['ochre_froglight', 'verdant_froglight', 'pearlescent_froglight'];

// 每条进度可自动检查的完成条件。false 表示只能由命令/特殊事件授予。
function advRuleDone(g, id) {
  const s = advStat(g), p = g.player;
  switch (id) {
    case 'story/root': return advHasKey(g, 'crafting_table');
    case 'story/mine_stone': return advHasAny(g, ['cobblestone', 'blackstone', 'cobbled_deepslate']);
    case 'story/upgrade_tools': return advHasKey(g, 'stone_pickaxe');
    case 'story/smelt_iron': return advHasKey(g, 'iron_ingot');
    case 'story/obtain_armor': return advHasAny(g, ADV_IRON_ARMOR);
    case 'story/lava_bucket': return advHasKey(g, 'lava_bucket');
    case 'story/iron_tools': return advHasKey(g, 'iron_pickaxe');
    case 'story/deflect_arrow': return s.deflect > 0;
    case 'story/form_obsidian': return advHasKey(g, 'obsidian');
    case 'story/mine_diamond': return advHasKey(g, 'diamond');
    case 'story/enter_the_nether': return g.dim === 'nether';
    case 'story/shiny_gear': return advHasAny(g, ADV_DIAMOND_ARMOR);
    case 'story/enchant_item': return s.enchant > 0;
    case 'story/cure_zombie_villager': return s.cured > 0;
    case 'story/follow_ender_eye': return s.stronghold > 0;
    case 'story/enter_the_end': return g.dim === 'end';

    case 'nether/root': return g.dim === 'nether';
    case 'nether/return_to_sender': return s.returnSender > 0;
    case 'nether/find_bastion': return s.bastion > 0;
    case 'nether/all_potions': return Object.keys(s.effects).length >= 9;
    case 'nether/all_effects': return Object.keys(s.effects).length >= 20;
    case 'nether/brew_potion': return s.brew > 0;
    case 'nether/charge_respawn_anchor': return s.chargeAnchor > 0;
    case 'nether/create_beacon': return s.beacon > 0;
    case 'nether/create_full_beacon': return s.beaconLevel >= 4;
    case 'nether/distract_piglin': return s.distract > 0;
    case 'nether/explore_nether': return Object.keys(s.netherBiomes).length >= 5;
    case 'nether/fast_travel': return s.netherTravel >= 7000;
    case 'nether/find_fortress': return s.fortress > 0;
    case 'nether/get_wither_skull': return advHasKey(g, 'wither_skeleton_skull');
    case 'nether/loot_bastion': return s.lootBastion > 0;
    case 'nether/netherite_armor': return advHasAll(g, ADV_NETHERITE_ARMOR);
    case 'nether/obtain_ancient_debris': return advHasKey(g, 'ancient_debris');
    case 'nether/obtain_blaze_rod': return advHasKey(g, 'blaze_rod');
    case 'nether/obtain_crying_obsidian': return advHasKey(g, 'crying_obsidian');
    case 'nether/ride_strider': return s.strider > 0;
    case 'nether/ride_strider_in_overworld_lava': return s.striderOverworld > 0;
    case 'nether/summon_wither': return s.wither > 0;
    case 'nether/uneasy_alliance': return s.uneasy > 0;

    case 'end/root': return g.dim === 'end';
    case 'end/kill_dragon': return s.dragon > 0;
    case 'end/dragon_breath': return advHasKey(g, 'dragon_breath');
    case 'end/dragon_egg': return advHasKey(g, 'dragon_egg') || s.dragonEgg > 0;
    case 'end/elytra': return advHasKey(g, 'elytra');
    case 'end/enter_end_gateway': return s.gateway > 0;
    case 'end/find_end_city': return s.endCity > 0;
    case 'end/levitate': return s.levitate > 0;
    case 'end/respawn_dragon': return s.respawnDragon > 0;

    case 'adventure/root': return true;
    case 'adventure/use_lodestone': return s.lodestone > 0;
    case 'adventure/heart_transplanter': return s.heartTransplant > 0;
    case 'adventure/kill_a_mob': return Object.keys(s.killHostile).length > 0;
    case 'adventure/spear_many_mobs': return s.spearMany > 0;
    case 'adventure/kill_all_mobs': return Object.keys(s.killHostile).length >= 20;
    case 'adventure/kill_mob_near_sculk_catalyst': return s.sculkKill > 0;
    case 'adventure/shoot_arrow': return s.arrow > 0;
    case 'adventure/sniper_duel': return s.sniper > 0;
    case 'adventure/ol_betsy': return s.crossbow > 0;
    case 'adventure/arbalistic': return s.arbalistic >= 5;
    case 'adventure/two_birds_one_arrow': return s.twoBirds > 0;
    case 'adventure/whos_the_pillager_now': return s.pillager > 0;
    case 'adventure/bullseye': return s.bullseye > 0;
    case 'adventure/sleep_in_bed': return s.sleep > 0;
    case 'adventure/trade': return s.trade > 0;
    case 'adventure/trade_at_world_height': return s.tradeHigh > 0;
    case 'adventure/voluntary_exile': return s.exile > 0;
    case 'adventure/hero_of_the_village': return s.raid > 0;
    case 'adventure/summon_iron_golem': return s.golem > 0;
    case 'adventure/totem_of_undying': return s.totem > 0;
    case 'adventure/very_very_frightening': return s.tridentVillager > 0;
    case 'adventure/throw_trident': return s.trident > 0;
    case 'adventure/lighten_up': return s.lighten > 0;
    case 'adventure/lightning_rod_with_villager_no_fire': return s.lightningSafe > 0;
    case 'adventure/honey_block_slide': return s.honeySlide > 0;
    case 'adventure/walk_on_powder_snow_with_leather_boots': return s.snowBoots > 0;
    case 'adventure/play_jukebox_in_meadows': return s.jukebox > 0;
    case 'adventure/read_power_of_chiseled_bookshelf': return s.bookshelf > 0;
    case 'adventure/spyglass_at_parrot': return s.spyParrot > 0;
    case 'adventure/spyglass_at_ghast': return s.spyGhast > 0;
    case 'adventure/spyglass_at_dragon': return s.spyDragon > 0;
    case 'adventure/minecraft_trials_edition': return s.trial > 0;
    case 'adventure/under_lock_and_key': return s.vault > 0;
    case 'adventure/revaulting': return s.ominousVault > 0;
    case 'adventure/who_needs_rockets': return s.windRockets > 0;
    case 'adventure/crafters_crafting_crafters': return s.crafter > 0;
    case 'adventure/overoverkill': return s.overkill > 0;
    case 'adventure/brush_armadillo': return s.brush > 0;
    case 'adventure/salvage_sherd': return s.sherd > 0;
    case 'adventure/craft_decorated_pot_using_only_sherds': return s.pot > 0;
    case 'adventure/trim_with_any_armor_pattern': return s.trim > 0;
    case 'adventure/trim_with_all_exclusive_armor_patterns': return s.trimAll > 0;
    case 'adventure/fall_from_world_height': return s.fall > 0;
    case 'adventure/avoid_vibration': return s.vibration > 0;
    case 'adventure/adventuring_time': return Object.keys(s.biomes).length >= 40;
    case 'adventure/blowback': return s.blowback > 0;

    case 'husbandry/root': return Object.keys(s.eat).length > 0;
    case 'husbandry/place_dried_ghast_in_water': return s.driedGhast > 0;
    case 'husbandry/uh_oh': return s.uhOh > 0;
    case 'husbandry/breed_an_animal': return Object.keys(s.breed).length > 0;
    case 'husbandry/bred_all_animals': return Object.keys(s.breed).length >= 20;
    case 'husbandry/tame_an_animal': return Object.keys(s.tame).length > 0;
    case 'husbandry/complete_catalogue': return Object.keys(s.cat).length >= 11;
    case 'husbandry/whole_pack': return Object.keys(s.wolf).length >= 8;
    case 'husbandry/plant_seed': return s.plant > 0;
    case 'husbandry/balanced_diet': return Object.keys(s.eat).length >= 30;
    case 'husbandry/fishy_business': return s.fish > 0;
    case 'husbandry/tactical_fishing': return s.fishBucket > 0;
    case 'husbandry/axolotl_in_a_bucket': return advHasKey(g, 'axolotl_bucket');
    case 'husbandry/tadpole_in_a_bucket': return advHasKey(g, 'tadpole_bucket');
    case 'husbandry/obtain_sniffer_egg': return advHasKey(g, 'sniffer_egg');
    case 'husbandry/feed_snifflet': return s.snifflet > 0;
    case 'husbandry/plant_any_sniffer_seed': return s.snifferSeed > 0;
    case 'husbandry/safely_harvest_honey': return s.honey > 0;
    case 'husbandry/wax_on': return s.waxOn > 0;
    case 'husbandry/wax_off': return s.waxOff > 0;
    case 'husbandry/silk_touch_nest': return s.silkNest > 0;
    case 'husbandry/make_a_sign_glow': return s.glowSign > 0;
    case 'husbandry/ride_a_boat_with_a_goat': return s.boatGoat > 0;
    case 'husbandry/allay_deliver_item_to_player': return s.allayItem > 0;
    case 'husbandry/allay_deliver_cake_to_note_block': return s.allayCake > 0;
    case 'husbandry/kill_axolotl_target': return s.axolotl > 0;
    case 'husbandry/froglights': return advHasAll(g, ADV_FROGLIGHTS);
    case 'husbandry/leash_all_frog_variants': return Object.keys(s.frog).length >= 3;
    case 'husbandry/remove_wolf_armor': return s.wolfArmorOff > 0;
    case 'husbandry/repair_wolf_armor': return s.wolfArmorRepair > 0;
    case 'husbandry/obtain_netherite_hoe': return advHasKey(g, 'netherite_hoe');
  }
  return false;
}

