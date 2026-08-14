export type Recipe = {
  key: string;
  title: string;
  kcal: number;
  /** Ingredient/style tags, matched against onboarding dislikedFoods substrings. */
  tags: string[];
};

// Small static library for v1. No LLM needed to generate this -- it's a
// curated list; the "intelligence" is in filtering/ranking, not generation.
export const RECIPES: Recipe[] = [
  { key: "chicken_broccoli", title: "鸡胸肉 + 西兰花", kcal: 420, tags: ["鸡肉", "西兰花"] },
  { key: "salmon_salad", title: "煎三文鱼沙拉", kcal: 480, tags: ["三文鱼", "生菜"] },
  { key: "beef_stirfry", title: "牛肉时蔬炒饭（少油）", kcal: 520, tags: ["牛肉", "米饭"] },
  { key: "tofu_veggie_bowl", title: "豆腐时蔬盖饭", kcal: 400, tags: ["豆腐", "米饭", "素食"] },
  { key: "egg_avocado_toast", title: "水波蛋牛油果全麦吐司", kcal: 380, tags: ["鸡蛋", "牛油果", "面包"] },
  { key: "shrimp_zucchini", title: "虾仁西葫芦意面", kcal: 440, tags: ["虾", "意面"] },
  { key: "turkey_wrap", title: "火鸡肉墨西哥卷", kcal: 410, tags: ["火鸡肉", "卷饼"] },
  { key: "quinoa_chickpea", title: "藜麦鹰嘴豆沙拉", kcal: 390, tags: ["藜麦", "鹰嘴豆", "素食"] },
  { key: "steak_asparagus", title: "煎牛排配芦笋", kcal: 540, tags: ["牛肉", "芦笋"] },
  { key: "mushroom_soup_bread", title: "菌菇浓汤 + 全麦面包", kcal: 360, tags: ["菌菇", "面包", "素食"] },
  { key: "pork_cabbage_stirfry", title: "瘦肉卷心菜炒", kcal: 430, tags: ["猪肉", "卷心菜"] },
  { key: "tuna_rice_bowl", title: "金枪鱼糙米饭", kcal: 450, tags: ["金枪鱼", "米饭"] },
  { key: "lentil_curry", title: "小扁豆咖喱（低脂）", kcal: 400, tags: ["扁豆", "素食", "咖喱"] },
  { key: "chicken_sweet_potato", title: "鸡胸肉 + 烤红薯", kcal: 460, tags: ["鸡肉", "红薯"] },
  { key: "greek_yogurt_bowl", title: "希腊酸奶坚果碗", kcal: 350, tags: ["酸奶", "坚果", "素食"] },
  { key: "beef_broccoli_soup", title: "牛肉西兰花汤面（少面）", kcal: 470, tags: ["牛肉", "西兰花", "面条"] },
  { key: "eggplant_tofu", title: "茄子豆腐煲（少油）", kcal: 410, tags: ["茄子", "豆腐", "素食"] },
  { key: "cod_veggies", title: "清蒸鳕鱼时蔬", kcal: 380, tags: ["鳕鱼"] },
];

export function getRecipeByKey(key: string): Recipe | undefined {
  return RECIPES.find((r) => r.key === key);
}
