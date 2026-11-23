import { defineComponent } from "vue";

/**
 * ACT: 连线改用 Canvas 绘制后，Vue Flow 的边组件插槽只需要「什么都不渲染」。
 * 保留插槽是为了不让库回退到内置 SimpleBezierEdge——那样每条边仍会生成两根 path，
 * 白占 2×边数 的 SVG 元素。边的数据与库内几何计算不受影响。
 */
export default defineComponent({
  name: "EdgePlaceholder",
  render: () => null,
});
