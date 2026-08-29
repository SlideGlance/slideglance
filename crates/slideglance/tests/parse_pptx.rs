//! End-to-end orchestration tests using synthetic PPTX archives built at
//! runtime. Real-fixture diff tests live in batch 4 of Phase 3-4.

use std::io::{Cursor, Write};

use slideglance::{parse_pptx, PptxDocument, SlideRenderOptions};
use slideglance_model::{Fill, SlideElement};
use zip::write::SimpleFileOptions;
use zip::CompressionMethod;
use zip::ZipWriter;

fn make_pptx(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let buf = Cursor::new(Vec::<u8>::new());
    let mut writer = ZipWriter::new(buf);
    let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, data) in entries {
        writer.start_file(*name, opts).unwrap();
        writer.write_all(data).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

const PRESENTATION_RELS: &str = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>"#;

const PRESENTATION: &str = r#"<?xml version="1.0"?>
<p:presentation xmlns:p="urn:p" xmlns:r="urn:r">
  <p:sldSz cx="9144000" cy="6858000"/>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId3"/>
  </p:sldIdLst>
</p:presentation>"#;

const THEME: &str = r#"<?xml version="1.0"?>
<a:theme xmlns:a="urn:a" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:srgbClr val="000000"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>"#;

const SLIDE_MASTER: &str = r#"<?xml version="1.0"?>
<p:sldMaster xmlns:p="urn:p" xmlns:a="urn:a">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr name="masterShape"/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
</p:sldMaster>"#;

const SLIDE_MASTER_RELS: &str = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"#;

const SLIDE_LAYOUT: &str = r#"<?xml version="1.0"?>
<p:sldLayout xmlns:p="urn:p" xmlns:a="urn:a">
  <p:cSld name="Title and Content">
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr name="layoutShape"/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sldLayout>"#;

const SLIDE_LAYOUT_RELS: &str = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdM1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>"#;

const SLIDE: &str = r#"<?xml version="1.0"?>
<p:sld xmlns:p="urn:p" xmlns:a="urn:a">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr name="slideShape"/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>"#;

const SLIDE_RELS: &str = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>"#;

#[test]
fn parses_minimal_pptx_end_to_end() {
    let bytes = make_pptx(&[
        ("ppt/presentation.xml", PRESENTATION.as_bytes()),
        (
            "ppt/_rels/presentation.xml.rels",
            PRESENTATION_RELS.as_bytes(),
        ),
        ("ppt/theme/theme1.xml", THEME.as_bytes()),
        ("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER.as_bytes()),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            SLIDE_MASTER_RELS.as_bytes(),
        ),
        ("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT.as_bytes()),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            SLIDE_LAYOUT_RELS.as_bytes(),
        ),
        ("ppt/slides/slide1.xml", SLIDE.as_bytes()),
        ("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS.as_bytes()),
    ]);
    let pres = parse_pptx(bytes).expect("parse_pptx");
    assert_eq!(pres.slides.len(), 1);
    assert_eq!(pres.info.slide_size.width.raw(), 9_144_000);

    let rendered = &pres.slides[0];
    assert_eq!(rendered.slide.slide_number, 1);
    assert_eq!(
        rendered.slide.layout_name.as_deref(),
        Some("Title and Content")
    );
    assert!(rendered.layout_show_master_sp);
    assert_eq!(rendered.layout_elements.len(), 1);
    assert_eq!(rendered.master_elements.len(), 1);

    // Slide-level background takes priority — solid red.
    let bg = rendered.slide.background.clone().expect("slide background");
    let fill = bg.fill.expect("background fill");
    match fill {
        Fill::Solid(s) => {
            assert_eq!(s.color.rgb, slideglance_color::Rgb::new(0xFF, 0, 0));
        }
        _ => panic!("expected solid"),
    }

    // Slide shape present.
    match &rendered.slide.elements[0] {
        SlideElement::Shape(s) => assert_eq!(s.object_name.as_deref(), Some("slideShape")),
        _ => panic!("expected shape"),
    }
}

#[test]
fn missing_presentation_returns_error() {
    let bytes = make_pptx(&[("[Content_Types].xml", b"<Types/>")]);
    let err = parse_pptx(bytes).unwrap_err();
    matches!(err, slideglance::PptxError::MissingPresentation);
}

#[test]
fn slide_falls_back_to_layout_background_when_slide_omits_one() {
    const SLIDE_NO_BG: &str = r#"<?xml version="1.0"?>
<p:sld xmlns:p="urn:p" xmlns:a="urn:a">
  <p:cSld>
    <p:spTree/>
  </p:cSld>
</p:sld>"#;
    const LAYOUT_WITH_BG: &str = r#"<?xml version="1.0"?>
<p:sldLayout xmlns:p="urn:p" xmlns:a="urn:a">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldLayout>"#;
    let bytes = make_pptx(&[
        ("ppt/presentation.xml", PRESENTATION.as_bytes()),
        (
            "ppt/_rels/presentation.xml.rels",
            PRESENTATION_RELS.as_bytes(),
        ),
        ("ppt/theme/theme1.xml", THEME.as_bytes()),
        ("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER.as_bytes()),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            SLIDE_MASTER_RELS.as_bytes(),
        ),
        (
            "ppt/slideLayouts/slideLayout1.xml",
            LAYOUT_WITH_BG.as_bytes(),
        ),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            SLIDE_LAYOUT_RELS.as_bytes(),
        ),
        ("ppt/slides/slide1.xml", SLIDE_NO_BG.as_bytes()),
        ("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS.as_bytes()),
    ]);
    let pres = parse_pptx(bytes).expect("parse_pptx");
    let bg = pres.slides[0]
        .slide
        .background
        .clone()
        .expect("inherited bg");
    match bg.fill.unwrap() {
        Fill::Solid(s) => assert_eq!(s.color.rgb, slideglance_color::Rgb::new(0x00, 0xFF, 0x00)),
        _ => panic!("expected solid green"),
    }
}

#[test]
fn slide_falls_back_to_master_background_when_slide_and_layout_omit() {
    const SLIDE_NO_BG: &str = r#"<?xml version="1.0"?>
<p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree/></p:cSld></p:sld>"#;
    const LAYOUT_NO_BG: &str = r#"<?xml version="1.0"?>
<p:sldLayout xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><p:spTree/></p:cSld></p:sldLayout>"#;
    const MASTER_WITH_BG: &str = r#"<?xml version="1.0"?>
<p:sldMaster xmlns:p="urn:p" xmlns:a="urn:a">
  <p:cSld>
    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="0000FF"/></a:solidFill></p:bgPr></p:bg>
    <p:spTree/>
  </p:cSld>
</p:sldMaster>"#;
    let bytes = make_pptx(&[
        ("ppt/presentation.xml", PRESENTATION.as_bytes()),
        (
            "ppt/_rels/presentation.xml.rels",
            PRESENTATION_RELS.as_bytes(),
        ),
        ("ppt/theme/theme1.xml", THEME.as_bytes()),
        (
            "ppt/slideMasters/slideMaster1.xml",
            MASTER_WITH_BG.as_bytes(),
        ),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            SLIDE_MASTER_RELS.as_bytes(),
        ),
        ("ppt/slideLayouts/slideLayout1.xml", LAYOUT_NO_BG.as_bytes()),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            SLIDE_LAYOUT_RELS.as_bytes(),
        ),
        ("ppt/slides/slide1.xml", SLIDE_NO_BG.as_bytes()),
        ("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS.as_bytes()),
    ]);
    let pres = parse_pptx(bytes).expect("parse_pptx");
    let bg = pres.slides[0].slide.background.clone().expect("master bg");
    match bg.fill.unwrap() {
        Fill::Solid(s) => assert_eq!(s.color.rgb, slideglance_color::Rgb::new(0, 0, 0xFF)),
        _ => panic!("expected solid blue"),
    }
}

#[test]
fn notes_are_attached_to_slide() {
    const SLIDE_RELS_WITH_NOTES: &str = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdL1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rIdN1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>"#;
    const NOTES: &str = r#"<?xml version="1.0"?>
<p:notes xmlns:p="urn:p" xmlns:a="urn:a">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
        <p:txBody>
          <a:bodyPr/>
          <a:p><a:r><a:t>Speaker notes here</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:notes>"#;
    let bytes = make_pptx(&[
        ("ppt/presentation.xml", PRESENTATION.as_bytes()),
        (
            "ppt/_rels/presentation.xml.rels",
            PRESENTATION_RELS.as_bytes(),
        ),
        ("ppt/theme/theme1.xml", THEME.as_bytes()),
        ("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER.as_bytes()),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            SLIDE_MASTER_RELS.as_bytes(),
        ),
        ("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT.as_bytes()),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            SLIDE_LAYOUT_RELS.as_bytes(),
        ),
        ("ppt/slides/slide1.xml", SLIDE.as_bytes()),
        (
            "ppt/slides/_rels/slide1.xml.rels",
            SLIDE_RELS_WITH_NOTES.as_bytes(),
        ),
        ("ppt/notesSlides/notesSlide1.xml", NOTES.as_bytes()),
    ]);
    let pres = parse_pptx(bytes).expect("parse_pptx");
    assert_eq!(
        pres.slides[0].slide.notes.as_deref(),
        Some("Speaker notes here")
    );
}

/// Build a slide whose shape tree nests `depth` groups around one shape.
fn nested_group_deck(depth: usize) -> Vec<u8> {
    let mut inner = String::from(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="99" name="deep"/></p:nvSpPr><p:spPr/></p:sp>"#,
    );
    for _ in 0..depth {
        inner = format!(
            r#"<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/><a:chOff x="0" y="0"/><a:chExt cx="100" cy="100"/></a:xfrm></p:grpSpPr>{inner}</p:grpSp>"#
        );
    }
    let slide = format!(
        r#"<?xml version="1.0"?>
<p:sld xmlns:p="urn:p" xmlns:a="urn:a">
  <p:cSld><p:spTree>{inner}</p:spTree></p:cSld>
</p:sld>"#
    );
    make_pptx(&[
        ("ppt/presentation.xml", PRESENTATION.as_bytes()),
        (
            "ppt/_rels/presentation.xml.rels",
            PRESENTATION_RELS.as_bytes(),
        ),
        ("ppt/theme/theme1.xml", THEME.as_bytes()),
        ("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER.as_bytes()),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            SLIDE_MASTER_RELS.as_bytes(),
        ),
        ("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT.as_bytes()),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            SLIDE_LAYOUT_RELS.as_bytes(),
        ),
        ("ppt/slides/slide1.xml", slide.as_bytes()),
        ("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS.as_bytes()),
    ])
}

/// Nesting an editor could plausibly produce still parses.
///
/// The ceiling exists to survive hostile input, not to reject decks
/// people actually build, so the depth a shape-grouping spree reaches
/// has to stay well inside it.
#[test]
fn deeply_nested_groups_within_the_ceiling_parse() {
    let pres = parse_pptx(nested_group_deck(64)).expect("64 nested groups must parse");
    assert_eq!(pres.slides.len(), 1);
    assert!(
        !pres.slides[0].slide.elements.is_empty(),
        "the group tree should be present"
    );
}

/// Nesting past the ceiling returns an error instead of ending the
/// process.
///
/// `<p:grpSp>` recurses through `SpTreeChild` and the deserializer
/// recurses with it, so the file decides how many frames are used.
/// Unbounded, a deck built with enough levels overflows the stack —
/// which aborts rather than failing, taking any host process with it.
#[test]
fn nesting_past_the_ceiling_is_an_error_not_an_abort() {
    let err = parse_pptx(nested_group_deck(2000))
        .expect_err("nesting this deep must be refused, not walked");
    let text = err.to_string();
    assert!(
        text.contains("deep") || text.contains("limit"),
        "error should name the nesting limit: {text}"
    );
}

// ---------------------------------------------------------------------
// firstSlideNum
// ---------------------------------------------------------------------

const PRESENTATION_RELS_TWO_SLIDES: &str = r#"<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>"#;

/// A slide whose only shape is the `sldNum` placeholder, carrying the
/// `<a:t>` cache PowerPoint recomputes and ignores.
const SLIDE_WITH_SLIDE_NUMBER: &str = r#"<?xml version="1.0"?>
<p:sld xmlns:p="urn:p" xmlns:a="urn:a">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr name="Slide Number Placeholder"/>
          <p:nvPr><p:ph type="sldNum" sz="quarter" idx="4"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm></p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:p>
            <a:fld id="{00000000-0000-0000-0000-000000000000}" type="slidenum">
              <a:rPr lang="en-US"/>
              <a:t>9999</a:t>
            </a:fld>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>"#;

fn deck_with_first_slide_num(attr: &str) -> Vec<u8> {
    let presentation = format!(
        r#"<?xml version="1.0"?>
<p:presentation xmlns:p="urn:p" xmlns:r="urn:r"{attr}>
  <p:sldSz cx="9144000" cy="6858000"/>
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId3"/>
    <p:sldId id="257" r:id="rId4"/>
  </p:sldIdLst>
</p:presentation>"#
    );
    make_pptx(&[
        ("ppt/presentation.xml", presentation.as_bytes()),
        (
            "ppt/_rels/presentation.xml.rels",
            PRESENTATION_RELS_TWO_SLIDES.as_bytes(),
        ),
        ("ppt/theme/theme1.xml", THEME.as_bytes()),
        ("ppt/slideMasters/slideMaster1.xml", SLIDE_MASTER.as_bytes()),
        (
            "ppt/slideMasters/_rels/slideMaster1.xml.rels",
            SLIDE_MASTER_RELS.as_bytes(),
        ),
        ("ppt/slideLayouts/slideLayout1.xml", SLIDE_LAYOUT.as_bytes()),
        (
            "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
            SLIDE_LAYOUT_RELS.as_bytes(),
        ),
        ("ppt/slides/slide1.xml", SLIDE_WITH_SLIDE_NUMBER.as_bytes()),
        ("ppt/slides/_rels/slide1.xml.rels", SLIDE_RELS.as_bytes()),
        ("ppt/slides/slide2.xml", SLIDE_WITH_SLIDE_NUMBER.as_bytes()),
        ("ppt/slides/_rels/slide2.xml.rels", SLIDE_RELS.as_bytes()),
    ])
}

/// Renders both slides and returns the printed folio of each.
fn rendered_folios(attr: &str) -> Vec<String> {
    let doc = PptxDocument::parse(deck_with_first_slide_num(attr), &[], &[], false)
        .expect("document parses");
    let options = SlideRenderOptions::default();
    (1..=doc.slide_count())
        .map(|n| {
            let svg = doc
                .render_slide(n, &options)
                .expect("render succeeds")
                .expect("slide exists")
                .svg;
            let start = svg.rfind("<tspan").expect("a tspan is emitted");
            let body = &svg[start..];
            let open = body.find('>').expect("tspan opens") + 1;
            let close = body.find("</tspan>").expect("tspan closes");
            body[open..close].to_string()
        })
        .collect()
}

#[test]
fn slide_number_field_starts_at_one_without_first_slide_num() {
    assert_eq!(rendered_folios(""), vec!["1", "2"]);
}

#[test]
fn slide_number_field_follows_first_slide_num() {
    // PowerPoint prints firstSlideNum on the first slide and counts up.
    assert_eq!(rendered_folios(r#" firstSlideNum="0""#), vec!["0", "1"]);
    assert_eq!(rendered_folios(r#" firstSlideNum="7""#), vec!["7", "8"]);
}

#[test]
fn slide_number_field_never_echoes_the_cached_text() {
    for folio in rendered_folios(r#" firstSlideNum="3""#) {
        assert_ne!(folio, "9999");
    }
}
